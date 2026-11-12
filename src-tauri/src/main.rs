use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

struct Pty {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
struct Session(Mutex<Option<Pty>>);

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Called by the frontend once its `pty` listener is attached, so no early output is lost.
#[tauri::command]
fn start(app: AppHandle, session: State<Session>, cols: u16, rows: u16) -> Result<(), String> {
    let mut slot = session.0.lock().unwrap();
    if slot.is_some() {
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
    // ponytail: points at the source tree's bin/, bundle it as a resource when we package a .app
    let bin = concat!(env!("CARGO_MANIFEST_DIR"), "/../bin");
    cmd.env("PATH", format!("{bin}:{}", std::env::var("PATH").unwrap_or_default()));

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // dev hook: type a command at startup (see NOTES.md)
    if let Ok(init) = std::env::var("MATHTERM_INIT") {
        let _ = writer.write_all(format!("{init}\r").as_bytes());
    }

    std::thread::spawn(move || {
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
            let _ = app.emit("pty", chunk);
        }
        let _ = child.wait();
        app.exit(0);
    });

    *slot = Some(Pty { writer, master: pair.master });
    Ok(())
}

#[tauri::command]
fn write(session: State<Session>, data: String) {
    if let Some(p) = session.0.lock().unwrap().as_mut() {
        let _ = p.writer.write_all(data.as_bytes());
    }
}

#[tauri::command]
fn resize(session: State<Session>, cols: u16, rows: u16) {
    if let Some(p) = session.0.lock().unwrap().as_ref() {
        let _ = p.master.resize(size(cols, rows));
    }
}

/// dev hook: after a few seconds, screenshot just this window to $MATHTERM_SHOT and quit.
fn shot_after_delay(app: AppHandle, path: String) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if let Some(w) = app.get_webview_window("main") {
            // it can open behind other windows, and screencapture -R grabs whatever is on top
            let _ = w.set_always_on_top(true);
            std::thread::sleep(std::time::Duration::from_millis(500));
            let s = w.scale_factor().unwrap_or(1.0);
            let pos = w.inner_position().unwrap().to_logical::<f64>(s);
            let size = w.inner_size().unwrap().to_logical::<f64>(s);
            let rect = format!("{},{},{},{}", pos.x, pos.y, size.width, size.height);
            let _ = std::process::Command::new("screencapture").args(["-x", "-R", &rect, &path]).status();
        }
        app.exit(0);
    });
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(path) = std::env::var("MATHTERM_SHOT") {
                shot_after_delay(app.handle().clone(), path);
            }
            Ok(())
        })
        .manage(Session::default())
        .invoke_handler(tauri::generate_handler![start, write, resize])
        .run(tauri::generate_context!())
        .expect("error while running mathterm");
}
