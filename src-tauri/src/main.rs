use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, EventTarget, Manager, State, WebviewWindow};

struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

/// One shell per window, keyed by window label.
#[derive(Default)]
struct Session(Mutex<HashMap<String, Pty>>);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Called by the frontend once its `pty` listener is attached, so no early output is lost.
#[tauri::command]
fn start(app: AppHandle, window: WebviewWindow, session: State<Session>, cols: u16, rows: u16) -> Result<(), String> {
    let label = window.label().to_string();
    let mut sessions = session.0.lock().unwrap();
    if sessions.contains_key(&label) {
        return Ok(()); // webview reloaded; keep the existing shell
    }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into()));
    cmd.arg("-l");
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("MATHTERM", "1");
    // Apps started from Finder get no LANG (Terminal.app sets one), and zsh/nvim then fall back to ASCII.
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // mdv: the source tree's bin/ in dev (edits apply without a rebuild), the bundled copy in the .app.
    let bin = if cfg!(debug_assertions) {
        concat!(env!("CARGO_MANIFEST_DIR"), "/../bin").into()
    } else {
        app.path().resource_dir().map_err(|e| e.to_string())?.join("bin").display().to_string()
    };
    cmd.env("PATH", format!("{bin}:{}", std::env::var("PATH").unwrap_or_default()));

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let reader_window = window.clone();
    let target = EventTarget::webview_window(label.clone());
    std::thread::spawn(move || {
        let window = reader_window;
        let mut buf = [0u8; 8192];
        let mut carry = Vec::new(); // a UTF-8 char can be split across reads
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            carry.extend_from_slice(&buf[..n]);
            let valid = match std::str::from_utf8(&carry) {
                Err(e) if e.error_len().is_none() => e.valid_up_to(), // incomplete tail: keep it
                _ => carry.len(),
            };
            let chunk = String::from_utf8_lossy(&carry[..valid]).into_owned();
            carry.drain(..valid);
            let _ = window.emit_to(target.clone(), "pty", chunk);
        }
        // Shell exited: close its window (the app quits after the last one).
        let _ = child.wait();
        let _ = window.close();
    });

    sessions.insert(label.clone(), Pty { writer, master: pair.master });

    // dev hook: type a command once the shell is up (see notes/dev.md). Typed immediately, zsh sometimes
    // dropped the Enter while it was still initializing, and the command sat at the prompt.
    if let (Ok(init), "main") = (std::env::var("MATHTERM_INIT"), label.as_str()) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            if let Some(p) = app.state::<Session>().0.lock().unwrap().get_mut("main") {
                let _ = p.writer.write_all(format!("{init}\r").as_bytes());
            };
        });
    }
    Ok(())
}

#[tauri::command]
fn write(window: WebviewWindow, session: State<Session>, data: String) {
    if let Some(p) = session.0.lock().unwrap().get_mut(window.label()) {
        let _ = p.writer.write_all(data.as_bytes());
    }
}

#[tauri::command]
fn resize(window: WebviewWindow, session: State<Session>, cols: u16, rows: u16) {
    if let Some(p) = session.0.lock().unwrap().get(window.label()) {
        let _ = p.master.resize(size(cols, rows));
    }
}

/// Fn-F (Globe-F) toggles full screen. macOS would map it to the menu's Enter Full Screen, but the web view
/// takes the key first and WebKit doesn't expose Fn to the page, so catch it in AppKit before the web view.
/// (Ctrl-Cmd-F does reach the default menu's View > Enter Full Screen.)
#[cfg(target_os = "macos")]
fn fn_f_fullscreen() {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags as M};
    let handler = block2::RcBlock::new(|ev: std::ptr::NonNull<NSEvent>| -> *mut NSEvent {
        let e = unsafe { ev.as_ref() };
        let flags = e.modifierFlags();
        let fn_f = flags.contains(M::Function)
            && !flags.intersects(M::Command | M::Control | M::Option | M::Shift)
            && e.charactersIgnoringModifiers().is_some_and(|s| s.to_string() == "f");
        if let (true, Some(mtm)) = (fn_f, objc2::MainThreadMarker::new()) {
            if let Some(w) = e.window(mtm) {
                w.toggleFullScreen(None);
                return std::ptr::null_mut(); // consumed: the shell doesn't get an "f"
            }
        }
        ev.as_ptr()
    });
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &handler) };
    std::mem::forget(monitor); // installed for the app's lifetime
}

/// Cmd-N: another window with its own shell, cascaded down-right from the one it was opened from.
#[tauri::command]
fn new_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    let label = format!("w{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let pos = window.outer_position().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(scale);
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::default())
        .title("mathterm")
        .inner_size(size.width, size.height)
        .position(pos.x + 24.0, pos.y + 24.0)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled) // as in tauri.conf.json
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Command line of the pty's foreground process (e.g. "nvim hw7.tex"), for auto-detect's ignore list.
/// Polled by the frontend; `ps` only runs when the foreground process changes.
#[derive(Default)]
struct Foreground(Mutex<HashMap<String, (i32, String)>>); // window label -> (pid, args)

#[tauri::command]
fn foreground(window: WebviewWindow, session: State<Session>, cache: State<Foreground>) -> String {
    let pid = session.0.lock().unwrap().get(window.label()).and_then(|p| p.master.process_group_leader());
    let Some(pid) = pid else {
        return String::new();
    };
    let mut cache = cache.0.lock().unwrap();
    let c = cache.entry(window.label().to_string()).or_default();
    if c.0 != pid {
        let out = std::process::Command::new("ps").args(["-ww", "-o", "args=", "-p", &pid.to_string()]).output();
        *c = (pid, out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default());
    }
    c.1.clone()
}

/// Contents of ~/.config/mathterm/config.json (or $MATHTERM_CONFIG), or "" if there isn't one.
/// The frontend parses it, so a broken file shows an error in the window instead of failing here.
#[tauri::command]
fn config() -> String {
    let path = std::env::var("MATHTERM_CONFIG")
        .or_else(|_| std::env::var("HOME").map(|h| format!("{h}/.config/mathterm/config.json")));
    path.ok().and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default()
}

/// Open an OSC 8 link in the default handler. Links come from arbitrary program output (`cat`-ing a file
/// is enough), so only web and mail URLs are allowed. The prefix check also rules out `open` option injection.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !["https://", "http://", "mailto:"].iter().any(|p| url.starts_with(p)) {
        return Err(format!("refusing to open {url}"));
    }
    std::thread::spawn(move || std::process::Command::new("open").arg(url).status());
    Ok(())
}

/// dev hook: screenshot just this window to $MATHTERM_SHOT after a few seconds, then quit.
/// The window is parked off-screen and the app never activates, so it doesn't interrupt whoever is using
/// the machine. That works because background throttling is disabled (tauri.conf.json): WebKit keeps
/// painting the window even though nothing on screen shows it.
fn shot_after_delay(app: &mut tauri::App, path: String) {
    app.set_activation_policy(tauri::ActivationPolicy::Accessory); // no Dock icon, no focus steal
    let app = app.handle().clone();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_position(tauri::LogicalPosition::new(-20000.0, 0.0));
    }
    std::thread::spawn(move || {
        // A failed earlier run's shell can outlive the app, finish its INIT and leave a stale `.ready`,
        // which would make this run shoot at once. INIT is only typed 1.5s in, so clearing it here is safe.
        let _ = std::fs::remove_file(format!("{path}.ready"));
        if let Some(w) = app.get_webview_window("main") {
            // MATHTERM_SHOT_SIZE=WxH resizes 2s in. Print before that to test reflow, or `sleep 3` in
            // MATHTERM_INIT to print at the new size.
            std::thread::sleep(std::time::Duration::from_secs(2));
            let size = std::env::var("MATHTERM_SHOT_SIZE").ok();
            if let Some((sw, sh)) = size.as_deref().and_then(|s| s.split_once('x')) {
                if let (Ok(sw), Ok(sh)) = (sw.parse::<f64>(), sh.parse::<f64>()) {
                    let _ = w.set_size(tauri::LogicalSize::new(sw, sh));
                }
            }
            // Wait for the INIT command to signal it's done (`touch $MATHTERM_SHOT.ready`; the shell inherits
            // the variable), then give the frame time to paint. Without a signal, shoot after ~20s.
            let ready = format!("{path}.ready");
            let signaled = (0..40).any(|_| {
                std::thread::sleep(std::time::Duration::from_millis(500));
                std::path::Path::new(&ready).exists()
            });
            std::thread::sleep(std::time::Duration::from_secs(if signaled { 1 } else { 0 }));
            let _ = std::fs::remove_file(&ready);
            // capture by window id (-l): works off-screen and never includes other windows
            let ns = w.ns_window().unwrap() as *const objc2::runtime::AnyObject;
            let id: isize = unsafe { objc2::msg_send![&*ns, windowNumber] };
            let _ = std::process::Command::new("screencapture")
                .args(["-x", "-o", "-l", &id.to_string(), &path])
                .status();
        }
        app.exit(0);
    });
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            fn_f_fullscreen();
            if let Ok(path) = std::env::var("MATHTERM_SHOT") {
                shot_after_delay(app, path);
            }
            Ok(())
        })
        .manage(Session::default())
        .manage(Foreground::default())
        // Closing a window drops its pty, which hangs up its shell.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<Session>().0.lock().unwrap().remove(window.label());
                window.state::<Foreground>().0.lock().unwrap().remove(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![start, write, resize, open_url, config, foreground, new_window])
        .run(tauri::generate_context!())
        .expect("error while running mathterm");
}
