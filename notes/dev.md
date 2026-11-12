# Dev

Needs Rust (`brew install rust`) and Node.

```sh
npm install        # also copies vendor files into ui/
npm start          # tauri dev: build + run
npm run app        # release .app, installed to /Applications
npm run shot       # launch, run `mdv demo.md`, screenshot just the window to shot.png, quit
npm run shot:docs  # same at 900x1010, saved as docs/demo.png for the README
bin/mdv --test     # mdv self-check
```

- Dev hooks (in `main.rs`): `MATHTERM_INIT` (command typed 1.5s after the shell starts), `MATHTERM_SHOT`
  (screenshot to that path once the INIT command runs `touch $MATHTERM_SHOT.ready`, or after ~20s, then quit),
  `MATHTERM_CONFIG` (config file to use instead of `~/.config/mathterm/config.json`), `MATHTERM_SHOT_SIZE=WxH` (resize 2s in, shot at 6s: print before that to test reflow, or put `sleep 3`
  in `MATHTERM_INIT` to print at the new size).
- Shot mode never touches the screen. The window is parked off-screen, the app uses the Accessory
  activation policy (no Dock icon, no focus steal), and the capture is `screencapture -l <window id>`.
  This relies on `backgroundThrottling: "disabled"` in `tauri.conf.json`: without it, WebKit stops painting
  a window that isn't visible (e.g. when you click away) and the shot comes out blank or missing.
- The window sometimes captures blank (no text at all), roughly 1 run in 6. Rerun.
- Earlier "missing" and "prompt only" shots were two races: INIT was typed before zsh finished starting
  (it sometimes dropped the Enter), and a fixed shot delay could beat `sleep N; mdv`. Fixed with the 1.5s
  INIT delay and the `.ready` signal.
- Gotcha: don't name a top-level `const` after a `window` property (`status`, `name`, ...). WebKit throws a
  SyntaxError and the whole script, and so the terminal, never runs.
- Gotcha: xterm sets an inline `display: block` on decoration elements, so CSS `display: flex` on them is
  ignored. Overlay children are absolutely positioned instead.
- App icon: `src-tauri/icons/icon.png` (1024px) and `icon.icns`, both written by `make_icon.py` (Pillow, KaTeX's
  own fonts) on the macOS grid (824px rounded square, transparent margin). Embedded at compile time, so
  restart `npm start` after changing it.
