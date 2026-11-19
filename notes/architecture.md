# Architecture

| File | Role |
|---|---|
| `src-tauri/src/main.rs` | Tauri backend. `start` spawns the login shell in a pty (`portable-pty`) and streams its output to the window as `pty` events (UTF-8 split across reads is carried over). `write` / `resize` commands go the other way. Sets `MATHTERM=1`. |
| `src-tauri/tauri.conf.json` | Window, CSP, and `frontendDist = ui/`. |
| `ui/renderer.js` | xterm.js terminal (WebGL renderer, DOM fallback on context loss): config, themes, zoom, find, keybindings, OSC 8 and plain-URL links (`addon-web-links`; Cmd-click opens via `open_url`, which only accepts `https://`, `http://` and `mailto:`), and the KaTeX measuring helpers auto-detect uses (`inkBox`, `fitInk`). Talks to Rust via `window.__TAURI__` (`withGlobalTauri`). |
| `ui/clipboard.js` | OSC 52 clipboard writes (nvim, tmux `set-clipboard on`, ssh) to the Rust `copy` command (`pbcopy`). Reads (`?`) are ignored. |
| `ui/themes.js` | Built-in color schemes (`default`, `catppuccin-mocha`) in xterm ITheme form. |
| `ui/automath.js` | Auto-detect mode: scans the viewport for LaTeX in any program's output and overlays typeset math on the source cells. Toggle with Cmd-Shift-M. |
| `ui/index.html` | Loads xterm.js, KaTeX, and styles for overlays / the measuring probe. |
| `ui/vendor/` | Copied from `node_modules` by `npm run vendor` (runs on `postinstall`). Gitignored. |
| `demo.md` | Sample file for manual / screenshot checks (`npm run shot` cats it). |

Tauri (not Electron): ~10 MB instead of ~200 MB, native WebKit webview, and Rust for the pty and any later
performance work. The shell is started by the frontend calling `start` *after* it attaches the `pty`
listener, so the first prompt isn't lost.

## Config, themes, zoom

- `~/.config/mathterm/config.json` (or `$MATHTERM_CONFIG`), read by the Rust `config` command at startup and
  parsed in the frontend, so a broken file shows an error in the status bar instead of failing:
  `{ "theme": "catppuccin-mocha" | { ...ITheme }, "fontSize": 14, "fontFamily": "Menlo, monospace",
  "lineHeight": 1.2, "autoDetectIgnore": ["*.tex", "*.sty", "*.cls"], "renderer": "webgl" | "dom" }`.
  A custom theme object is merged over `default`, so a partial one works.
- `applyTheme` sets xterm's theme plus CSS variables (`--bg`, `--fg`, `--dim`, `--status-bg`) for
  everything drawn outside xterm: math overlays, the status bar, the find box. Auto-detect resolves palette
  indexes through the theme's 16 colors (`ANSI_KEYS`).
- Zoom: Cmd-+ / Cmd-- / Cmd-0 (back to the config's size) via `setFontSize`, which refits, resizes the pty,
  and sets `--font-size` (KaTeX overlays).
  Auto-detect overlays rebuild on their own, since cell size is part of their key.
- Keybindings: xterm allows one custom key handler, so `renderer.js` owns it and features push onto
  `keyBindings` (auto-detect's Cmd-Shift-M does). Cmd-N calls the Rust `new_window` command.
