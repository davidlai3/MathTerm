# mathterm notes

A terminal that typesets LaTeX natively (KaTeX, vector text) instead of approximating it with Unicode or images.

## Architecture

| File | Role |
|---|---|
| `src-tauri/src/main.rs` | Tauri backend. `start` spawns the login shell in a pty (`portable-pty`) and streams its output to the window as `pty` events (UTF-8 split across reads is carried over). `write` / `resize` commands go the other way. Sets `MATHTERM=1` and puts `bin/` on `PATH`. |
| `src-tauri/tauri.conf.json` | Window, CSP, and `frontendDist = ui/`. |
| `ui/renderer.js` | xterm.js terminal + the OSC 7777 handler: measures and draws KaTeX as xterm decorations. Talks to Rust via `window.__TAURI__` (`withGlobalTauri`). |
| `ui/index.html` | Loads xterm.js, KaTeX, and styles for overlays / the measuring probe. |
| `ui/vendor/` | Copied from `node_modules` by `npm run vendor` (runs on `postinstall`). Gitignored. |
| `bin/mdv` | Python (stdlib only). Prints markdown, turning `$..$` / `$$..$$` into OSC 7777. |
| `demo.md` | Sample file for manual / screenshot checks. |

Tauri (not Electron): ~10 MB instead of ~200 MB, native WebKit webview, and Rust for the pty and any later
performance work. The shell is started by the frontend calling `start` *after* it attaches the `pty`
listener, so the first prompt isn't lost.

## Protocol: OSC 7777

```
query:  ESC ] 7777 ; ? ; <i|d> ; <latex> BEL           (program -> terminal)
reply:  ESC ] 7777 ; = ; <cols> ; <rows> BEL            (terminal -> program, on its stdin/tty)
draw:   ESC ] 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL
```

- `i` = inline (squeezed into one row), `d` = display.
- `draw` overlays KaTeX on a `cols x rows` box starting at the cursor. The **sender** reserves the space:
  spaces after an inline draw, newlines after a display draw. The terminal never moves the cursor.
- LaTeX must not contain newlines, ESC or BEL (mdv collapses whitespace).
- Replies arrive in query order. `mdv` sends all queries in one batch, reads replies from `/dev/tty` in raw
  mode with a 1s timeout, and falls back to guessed sizes if they don't all arrive.

## Dev

Needs Rust (`brew install rust`) and Node.

```sh
npm install        # also copies vendor files into ui/
npm start          # tauri dev: build + run
npm run shot       # launch, run `mdv demo.md`, screenshot just the window to shot.png, quit
bin/mdv --test     # mdv self-check
```

- Dev hooks (in `main.rs`): `MATHTERM_INIT` (command typed at startup), `MATHTERM_SHOT` (after 5s,
  `screencapture -R` the window's rect to that path, then quit).
- `src-tauri/icons/icon.png` is a placeholder (Tauri needs one to compile). Run `npx tauri icon <png>` for a real one.

## Changelog

### 2026-11-11: inline overflow, README
- Inline math may now spill 25% past its row (`INLINE_OVERFLOW` in `renderer.js`) before shrinking, so
  superscripts like `e^{i\pi}` render at text size. Fractions still shrink (~0.6x); see plan 1.
- `npm run shot` raises the window (always-on-top) before capturing. Without it the window could open
  behind other apps, and `screencapture -R` would grab whatever was on top.
- Added `README.md` and `docs/demo.png`. Added an inline fraction line to `demo.md`.

### 2026-11-11: ported Electron -> Tauri
- Replaced `main.js` / `preload.js` with `src-tauri/src/main.rs` (`portable-pty`). Dropped `electron` and `node-pty`
  (and the `spawn-helper` chmod workaround).
- Frontend moved to `ui/`. Libraries are vendored there because Tauri serves a single directory.
- Shell spawn is now triggered by the frontend (`start`) with its real size instead of a fixed 80x24.
- `npm run shot` now captures only the window rect (the Electron version used `capturePage`).
- Verified: the size query round-trips (display `\int..` measured 11 cols vs 18 guessed), and the demo renders the same in WebKit.

### 2026-11-11: measured sizing
- Added the query/reply step: the terminal renders KaTeX into a hidden probe and reports its size in cells.
  This replaced the length-based guess, so inline math has no gaps.
- `draw` now carries an explicit `i|d` mode (it used to be inferred from `rows > 1`).
- Display math is centered by `mdv` padding the line (width is now exact).
- `mdv` only renders when stdout is a tty, so `mdv f.md > out` stays clean.
- `mdv` rewritten as a single tokenize pass, with tests on a fixed sizer.

### 2026-11-11: initial draft
- Electron + xterm.js + node-pty + KaTeX, OSC 7777 draw with sender-guessed sizes, `mdv`.

## Plans / known issues

Roughly in priority order:

1. **Inline fractions are small.** Inline math now gets 1.25 rows, which covers superscripts. Next option if
   fractions bother us: give inline math 2 rows when its scale would drop below ~0.7 (cost: uneven line spacing).
2. **Rest of markdown.** `mdv` only handles math; headings, bold, lists and code print raw. Options: ANSI
   styling in `mdv` itself, or pipe through glow for the non-math parts.
3. **Resize / reflow.** Decorations keep their original x and line, so window resizes misalign them.
   Re-render on resize, or drop math whose line reflowed.
4. **Line wrap.** Inline math that straddles the right edge is clipped. `mdv` could wrap the text itself.
5. **Selection / copy.** Copying a math region yields spaces. Could put the LaTeX source on the clipboard.
6. **`tex` one-liner** (`tex '\sqrt{2}'`) and a shell hook so normal command output can contain math.
7. Later: tabs/splits, config (font, theme), packaging as a `.app` (needs `bin/` bundled as a resource,
   real icons, `bundle.active = true`).
