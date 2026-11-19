# Linux support: roadmap

Status: not started. macOS is the only target today. Order: compile on Linux, then make it work there, then
releases. Native Windows is not planned (see the end).

## What's macOS-only now

| Where | What | Linux |
|---|---|---|
| `Cargo.toml` | `objc2*`, `block2` are unconditional deps | gate under `[target.'cfg(target_os = "macos")'.dependencies]` |
| `main.rs` `shot_after_delay` | `ns_window`, `screencapture`, `ActivationPolicy`, called on every OS | `#[cfg(target_os = "macos")]` (dev hook stays macOS-only) |
| `main.rs` `open_url` | `open` | `xdg-open` via `cfg`. The URL is an argument (no shell), so the prefix check stays sufficient |
| `main.rs` `copy` | `pbcopy` | `tauri-plugin-clipboard-manager` on both (X11 vs Wayland tools differ, and paste needs reads) |
| `main.rs` `start` | `$SHELL -l`, fallback `/bin/zsh` | fallback `/bin/sh` |
| `main.rs` `foreground` | `process_group_leader` + `ps -ww` | works (procps) |
| `main.rs` `config`, `save_debug` | `$HOME` | fine (`$XDG_CONFIG_HOME` is a nicety) |
| `main.rs` `fn_f_fullscreen`, `no_press_and_hold` | AppKit | already `cfg`-gated; add F11 → `set_fullscreen` |
| `renderer.js`, `automath.js` | every binding is `e.metaKey` (Cmd); link activate checks `metaKey` | see Keybindings |
| copy/paste | Cmd-C/V come from Tauri's default macOS Edit menu | no menu: nothing copies or pastes. Bind Ctrl-Shift-C/V |
| `renderer.js` font | `Menlo, monospace` | stack: `Menlo, 'DejaVu Sans Mono', monospace` |
| `tauri.conf.json` | `targets: ["app"]` | add `appimage`, `deb` |
| `release.yml` | one macOS job creates the release | matrix |

## Keybindings

Ctrl alone belongs to the shell, so on Linux the Cmd bindings become Ctrl-Shift (what GNOME Terminal does).
One `mod(e)` helper (`e.metaKey` on mac, `e.ctrlKey && e.shiftKey` elsewhere) used by the `keyBindings`
entries and the Cmd-Shift-M handler in `automath.js`:

| macOS | Linux |
|---|---|
| Cmd-C / Cmd-V | Ctrl-Shift-C / Ctrl-Shift-V (new: `term.getSelection()` / clipboard read → `write`) |
| Cmd-F, Cmd-N | Ctrl-Shift-F, Ctrl-Shift-N |
| Cmd-Shift-M, Cmd-Shift-D | Ctrl-Shift-M, Ctrl-Shift-D (Shift is already in these, so `mod` is Ctrl here) |
| Cmd +/-/0 | Ctrl +/-/0 (convention; no shell uses them) |
| Cmd-click link | Ctrl-click |
| Fn-F / Ctrl-Cmd-F | F11 |

Platform check in the frontend: `navigator.platform`/`userAgent`, or a Rust `os` command (`std::env::consts::OS`).

## Phase 0: builds on Linux (small)

1. Gate the macOS deps and `shot_after_delay` (table above).
2. `open_url` → `xdg-open` on Linux; `copy` → the clipboard plugin (add it to `capabilities/default.json`).
3. CI: `cargo check` on `ubuntu-22.04` in a non-release workflow, so macOS-only code can't creep back in.

## Phase 1: works on Linux (medium)

1. Keybindings, Ctrl-Shift-C/V, font stack.
2. Shell fallback `/bin/sh`.
3. WebKitGTK is the webview. Risks to check by hand: WebGL (context loss → the existing DOM fallback;
   `"renderer": "dom"` is the escape hatch), KaTeX measurements (`inkBox`/`fitInk` use `getBoundingClientRect`,
   same engine family as macOS so probably fine), HiDPI scaling on Wayland.
4. Build deps for CI/dev: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev` (see Tauri's Linux prerequisites).
5. Bundle AppImage + .deb, built on `ubuntu-22.04` (oldest glibc we accept; AppImages only run on glibc ≥ the
   build machine's).
6. Optional: OSC 52 `p` → primary selection (`clipboard.js` currently sends every selection to the clipboard).

## Phase 2: release + docs (small)

1. `release.yml`: build jobs on `macos-latest` and `ubuntu-22.04` each upload an artifact; one final job
   downloads both and runs `gh release create` with every file.
2. Version bump stays in the same three files.
3. README: Linux install. Update `architecture.md` (`pbcopy`/`open` mentions, keybindings) and `dev.md`
   (Linux deps, shot hooks macOS-only).

## Not planned: native Windows (WSLg instead)

The Linux build should run on Windows 11 through WSLg (WSL's Linux GUI support), likely where Windows users
of a LaTeX terminal already work. Untested; if it works, the README points there.

What native Windows would add, if it's ever wanted:
- Shell: no `$SHELL`/`-l`; `pwsh.exe` → `powershell.exe` → `%COMSPEC%`, cwd `%USERPROFILE%`. A `"shell"`
  config option (e.g. `wsl.exe`).
- ConPTY re-renders the stream: repaints on resize (check auto-detect reflow / `isWrapped`), and older builds
  drop OSC 8 and OSC 52.
- `foreground`: `process_group_leader` is `None`, so `autoDetectIgnore` does nothing.
- `open_url`: never `cmd /c start` (`&` in a URL is command injection); use `tauri-plugin-opener`.
- WebView2 is Chromium, not WebKit: re-check KaTeX measuring.
- NSIS installer, unsigned → SmartScreen warning.

## Open questions

- Ctrl-Shift for everything, or Alt for some (Kitty-style)?
