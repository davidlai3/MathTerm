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
| `bin/mdv` | Python (stdlib; pygments optional). Styles markdown with ANSI and turns `$..$` / `$$..$$` into OSC 7777. Math and code spans are swapped for private-use placeholders and the math is sized first; then lines are styled (tables need math widths), and placeholders are expanded last. |
| `demo.md` | Sample file for manual / screenshot checks. |

Tauri (not Electron): ~10 MB instead of ~200 MB, native WebKit webview, and Rust for the pty and any later
performance work. The shell is started by the frontend calling `start` *after* it attaches the `pty`
listener, so the first prompt isn't lost.

## Protocol: OSC 7777

```
query:  ESC ] 7777 ; ? ; <i|d> ; <latex> BEL           (program -> terminal)
reply:  ESC ] 7777 ; = ; <cols> ; <rows> BEL            (terminal -> program, on its stdin/tty)
draw:   ESC ] 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL
rule:   ESC ] 7777 ; rule ; <h1|hr> BEL                 (full-width line on the current row)
```

- `i` = inline, `d` = display.
- Inline `rows` is 1 (fits its row, may spill 25% above/below) or 3 ("tall": scale would drop below
  `TALL_SCALE` = 0.85, so the sender puts a blank line above and below that line and the math is drawn
  centered on its row with up to 3 rows of height). On every placement the terminal checks that the rows
  above and below are empty under the math; if not (e.g. wrapped text after a resize), it fits one row.
- Display math is centered by the terminal (x is ignored), which keeps it centered after a resize.
- Links are standard OSC 8 hyperlinks (`ESC ] 8 ;; url ESC \ text ESC ] 8 ;; ESC \`). mathterm shows the URL in a
  status bar on hover and opens it on Cmd-click via the `open_url` command, which only accepts `https://`,
  `http://` and `mailto:` (links can come from any program's output).
- `rule` lines are drawn by the terminal at the current width, so they never wrap. Outside mathterm,
  `mdv` falls back to `═`/`─` characters.
- `draw` overlays KaTeX on a `cols x rows` box at the cursor. The **sender** reserves the space:
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
npm run shot:docs  # same at 900x1010, saved as docs/demo.png for the README
bin/mdv --test     # mdv self-check
```

- Dev hooks (in `main.rs`): `MATHTERM_INIT` (command typed at startup), `MATHTERM_SHOT` (screenshot to that
  path after 5s, then quit), `MATHTERM_SHOT_SIZE=WxH` (resize 2s in, shot at 5s: print before that to test reflow, or put `sleep 3`
  in `MATHTERM_INIT` to print at the new size).
- Shot mode never touches the screen. The window is parked off-screen, the app uses the Accessory
  activation policy (no Dock icon, no focus steal), and the capture is `screencapture -l <window id>`.
  This relies on `backgroundThrottling: "disabled"` in `tauri.conf.json`: without it, WebKit stops painting
  a window that isn't visible (e.g. when you click away) and the shot comes out blank or missing.
- Gotcha: don't name a top-level `const` after a `window` property (`status`, `name`, ...). WebKit throws a
  SyntaxError and the whole script, and so the terminal, never runs.
- Gotcha: xterm sets an inline `display: block` on decoration elements, so CSS `display: flex` on them is
  ignored. Overlay children are absolutely positioned instead.
- `src-tauri/icons/icon.png` is a placeholder (Tauri needs one to compile). Run `npx tauri icon <png>` for a real one.

## Changelog

### 2026-11-11: tables, syntax highlighting, clickable links
- **Tables:** GFM tables (header row + `|---|:-:|--:|` separator) render with box-drawing borders, a bold
  header and column alignment. Column widths use visible width: ANSI is stripped, and math counts as its
  measured cell width, which is why math is now sized before styling. Pipes inside math or code spans don't
  split cells. Tall math in a cell gets bordered spacer rows instead of blank lines.
- **Syntax highlighting:** fenced blocks with a language use pygments (`monokai`) if it's installed; otherwise
  a built-in highlighter colors comments (`#` or `//` and `/* */` by language), strings, numbers and common
  keywords. Blocks without a language keep the plain code color.
- **Links:** `[text](url)` is an OSC 8 hyperlink everywhere (iTerm2 supports these too). In mathterm the
  `(url)` suffix is dropped: hovering shows the URL in a status bar and Cmd-click opens it (`open_url` in
  Rust, http(s)/mailto only). Plain clicks still select text.
- Shot hook: resize moved to 2s in. Added `npm run shot:docs`.
- Bug hit along the way: `const status` shadowed `window.status`, WebKit threw, and the terminal was blank.

### 2026-11-11: rough edges: tall overlap, rules, screenshots
- **Tall inline math vs. re-wrapped text:** `place()` checks the rows above/below for text under the math
  (`rowFree`) and falls back to the 1-row size if either is occupied. Re-checked on every resize, so it
  regains full size when the window widens again.
- **Rules:** new `OSC 7777;rule;<h1|hr>`. The terminal draws a full-width line and re-places it on resize.
  `mdv` uses it for the h1 underline and `---`.
- **Centering bug:** `.math` relied on `display: flex`, which xterm's inline `display: block` overrode, so
  inline math sat at the top of its row and only spilled downward. Overlay content is now absolutely
  positioned and centered with `translate(-50%)`.
- **`npm run shot` reliability:** shots failed when the window got covered (e.g. clicking away while working).
  Disabled background throttling. Shot mode now parks the window off-screen, never activates the app,
  and no longer calls `set_focus`.

### 2026-11-11: tall inline math, resize re-placement
- **Fixed fraction shrink bug.** Drawing scaled with `scrollWidth/Height`, which also counts KaTeX's hidden
  MathML copy. WebKit lays that copy out taller for fractions, so they rendered at ~0.6x even though they fit.
  Drawing now uses `getBoundingClientRect`, like `measure()`. Simple fractions render at full size in one row.
- **Tall inline math:** if the scale would still drop below 0.85 (nested fractions, `\sum` with limits), the
  terminal reports `rows = 3` and `mdv` adds a blank line above and below that line.
- **Resize:** each drawn expression is stored with a marker on the first row of its logical line plus a
  column offset. On `term.onResize` every decoration is re-placed at `row = offset / cols`,
  `x = offset % cols`, so inline math follows its text when lines re-wrap. Display math is re-centered.
  Expressions whose marker has left the scrollback are dropped.
- `mdv` no longer pads display math with spaces (the terminal centers it). Padding was real cells that would
  wrap on narrow windows.
- Added `MATHTERM_SHOT_SIZE`. Verified at 900 and 380 px wide.

### 2026-11-11: markdown styling in mdv
- `mdv` styles headings (h1 magenta with a rule, h2+ blue), bold, italic (`*` and `_`, but not snake_case),
  strikethrough, inline code, fenced code blocks (fences dropped, indented), lists (`•`), quotes (`│`),
  horizontal rules, links (`text (url)`) and images (`[image: alt]`).
- Code spans and code blocks are never math (`` `$x$` `` stays code).
- It now also styles in other terminals, leaving math as LaTeX source there. Redirected output is still unchanged.
- Display math reuses the source's line breaks, so there are no extra blank lines around `$$..$$`.
- `npm run shot` captures by window id (`-l`, via `objc2` for `windowNumber`) after focusing the window.
  The `-R` rect capture had picked up the app switcher and other windows.
- Demo and `docs/demo.png` updated to show every style.

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

### Goal: render LaTeX in any program's output, including editors (next up)

An **auto-detect mode** (toggleable) where the terminal itself scans rendered rows for `$..$`, `$$..$$`,
`\(..\)`, `\[..\]` and overlays typeset math on the source's own cells. Programs don't cooperate:
this covers Claude Code and other CLIs printing plain LaTeX, and **math inside nvim/vim/helix while
editing**, with no editor plugin.

- **Placement:** math must fit the rectangle the source text occupies (no reserved space, since the program
  owns the layout). LaTeX source is usually wider than its rendering, so this mostly works. Shrink to fit
  otherwise. Multi-line `$$` blocks get the rows they span; a one-line display `$$..$$` gets one row.
- **Editing:** the cursor row (and any block containing it) shows the raw source, like Obsidian's live preview.
- **Redraws:** TUIs (Claude Code, nvim) redraw constantly. Overlays are screen-positioned (viewport row/col),
  recomputed for the viewport after each render and diffed by key, with KaTeX output cached, so unchanged
  math isn't re-rendered.
- **Editor layout:** matches can't cross a vertical split border (`│`). Soft-wrapped math that spans rows
  is missed. Line numbers and the sign column are harmless.
- **False positives:** use `mdv`'s rules (no space inside `$`, closing `$` not followed by a digit) and require
  KaTeX to parse without error.
- **Copy:** the cells still hold the source, so copying math yields LaTeX for free.
- To check: how Claude Code's markdown renderer treats backslashes, `_` and `*` in its output. Markdown
  could eat `\(`, `\\` or underscores before the terminal ever sees them.

### Goal: full live preview (after auto-detect)

Auto-detect only typesets math. For a fully styled page (headings, tables) beside the editor:

1. **`mdv --watch <file>`.** Re-render on change, on the alternate screen so each frame replaces the last.
   Needs a protocol op to clear drawn items (`OSC 7777;clear`).
2. **Native splits in mathterm.** Editor on one side, preview on the other. tmux isn't a shortcut: it
   swallows unknown OSCs and repaints the whole screen, which breaks line-anchored overlays.
3. **Tiny nvim plugin, only if needed.** E.g. send the buffer on `TextChanged` so the preview updates per
   keystroke rather than per `:w`, sync scroll, or hide math for all of insert mode.

### Smaller items

1. **Markdown gaps.** Tables wider than the window wrap and break their borders (could shrink columns or
   wrap cell text). Escaped `\|` in table cells isn't handled. Bare URLs aren't clickable (xterm's web-links
   addon would do it). Nested blockquotes, numbered-list styling and footnotes print mostly raw.
2. **Line wrap.** Inline math that straddles the right edge is clipped. `mdv` could wrap the text itself.
3. **Selection / copy.** Copying a math region yields spaces. Could put the LaTeX source on the clipboard.
4. **`tex` one-liner** (`tex '\sqrt{2}'`) and a shell hook so normal command output can contain math.
5. Later: tabs/splits, config (font, theme), packaging as a `.app` (needs `bin/` bundled as a resource,
   real icons, `bundle.active = true`). Splits are covered by the live-preview goal above.
