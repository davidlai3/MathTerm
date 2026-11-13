# Changelog

New entries go above the latest release marker; everything below a marker shipped in that release.

## 2026-11-13: inline math wrapped mid-sentence
- A soft-wrapped line with math and text left any match straddling the edge raw. Now the whole logical line
  is reflowed: one overlay over its rows, text runs and math in a `pre-wrap` flow at the line's width, the
  browser re-wraps it (`reflow` in `findIn`, `makeReflow`). Also fixes words the terminal split at the edge
  (`f` / `or`) staying split. Falls back to source if the flow needs more rows than the source.
- Text runs shared with `joinRows` (`cellStyle`, `pushRun`, `runSpan`). Reflowed text gets `letter-spacing`
  so the font's advance matches the cell width.
- Verified: 4 new tests (the todo test now passes) and a screenshot at 520px wide (`$\frac{hc}{\lambda}$`
  and `$\sum..$` straddling the edge, prose re-wrapped). Not covered: programs that wrap with real newlines
  (Claude Code).

## 2026-11-13: auto-detect test suite
- `npm test`: `test/automath.test.js` (node:test, `@xterm/headless` dev dependency) runs automath.js against
  a real xterm buffer. 34 tests on current behavior (delimiters, fences, cursor row, wide chars, raw
  spans, joining, growing/centering, blocks, stray `$$` closers, soft wraps, tmux panes, tables, `unstrip`,
  `splitCells`, `cellHtml`, ignore list) plus 6 `todo` tests for known bugs from plans.md.
- Found while writing it: multi-row `$$` block tex keeps each row's trailing blanks (`a + b      ...  = c`).
  Harmless to KaTeX, but it's in the cache key.

---
**v0.1.1 released 2026-11-13** (commit `ff90a77`): everything below.

---
## 2026-11-13: key repeat
- Holding a letter opened macOS's accent picker instead of repeating (WebKit press-and-hold). `main.rs`
  registers `ApplePressAndHoldEnabled = NO` in the app's registration domain before the app starts
  (in-memory only; a `defaults write dev.mathterm ...` still wins).

---
**v0.1.0 released 2026-11-13** (commit `8cc9731`): everything below.

---

## 2026-11-12: math in Claude Code's box-drawn tables
- A table row with two math spans (`│ $\mathbf{f}$ │ ... $\rho\mathbf{g}$ │`, user screenshot) was joined
  into one overlay, so the `│` between the cells was redrawn shifted left. `joinRows` now never joins
  matches across a `│`. Verified by screenshot (box table row, plain row with two matches still joined).
- Same screenshot: `\underbrace{..}_{\text{..}}` labels rendered inline beside empty braces. Claude Code read the
  `}_{ .. }_` pairs as `_italic_` and dropped every `_`, and `\,` became `,`. `unstrip` now puts `_` back
  before a group right after `\underbrace{..}`, and `\,` for a comma beside `\times` / `\cdot`.
- A `$$` block whose rows soft-wrapped was joined with spaces (`\und erbrace`), failed to parse and stayed raw.
  Wrapped continuation rows now join with no space.
- Verified: unit check of `unstrip`, screenshot of the user's exact text (wrapped at 900px wide).

## 2026-11-12: tmux / editor vertical splits
- With a tmux split, `$$` blocks went raw (user screenshot): their rows also held the border and the other
  pane, so no row was "only `$$`". And the other pane's visible cursor (a shell prompt on row 0) marked
  row 0 as being edited, so its math stayed raw too.
- `paneRanges` finds full-height vertical borders (a column of `│` on all but ~3 rows) and `findIn` scans
  each pane as its own column range: own fence/block/table state, cursor only counts in its own pane.
  `grow` keeps rows taken per pane, `joinRows` groups per pane, `centerDisplay` centers within the pane.
- Inside a pane, a row whose text reaches the pane's last column (within one: tmux may break on a space)
  continues on the next row. tmux and nvim break lines there with cursor moves, not soft wraps.
- Verified by screenshot with tmux (math on row 0 next to the other pane's cursor, a multi-row block, a
  one-line block, a long display line wrapped in the pane) and without a split (no change).
- Limits: only full-height borders, so a vertical border inside one half of a top/bottom split isn't seen.
  Inline math wrapped mid-sentence at the pane edge stays raw, as at the window edge.

## 2026-11-12: matrices under nvim's conceal
- In normal mode nvim conceals markdown escapes (`\\` shows as `\`, `\{` as `{`), so a `bmatrix` arrived with no
  row breaks and rendered as one row (user screenshot; fine in insert mode, where conceal is off). `unstrip`
  now restores `\\` for a lone `\` before whitespace inside matrix-like environments (`ROWS_ENV`: matrix
  variants, `cases`, `aligned`, `align`, `array`, `gathered`, `split`, ...). Claude Code strips the same escape.
- Braces (`\{1, \ldots, m\}` -> `{1, \ldots, m}`) still can't be repaired: `{..}` is also plain grouping.
  The nvim-side fix is `conceallevel=0` for markdown.
- Verified: unit test of `unstrip` and a screenshot of the concealed matrix.

## 2026-11-12: `autoDetectTables` config
- `"autoDetectTables": false` turns off auto-detected tables (user wants nvim plugins to draw them); math in
  table rows is still typeset. Default on.

## 2026-11-12: gap with math at the row's end, nvim typing flicker
- `joinRows` skipped rows whose *last* match ends the row, so text between two matches kept its gap
  (`$X_n$ depends on $X_{n-1}, \dots, X_0$`, user screenshot). Now only a lone match at the row's end is
  skipped. Verified by screenshot.
- Typing in nvim on a line with math flickered: nvim hides the cursor during every redraw, and since the
  scroll-flicker fix a hidden cursor meant "no editing row", so a paint mid-redraw typeset the line for a
  frame. Now the row the cursor hid on still counts as the editing row for `HIDE_GRACE` (300 ms), after which a
  rescan typesets it (Claude Code keeps the cursor hidden). Not yet verified in nvim.
- Shot hook deletes a stale `$MATHTERM_SHOT.ready` at startup: a failed run's shell can outlive the app and
  touch it later, making the next run with the same path shoot immediately.

## 2026-11-12: display math centered on the window
- `centerDisplay` in `automath.js`: auto-detected display math (multi-row blocks, one-line `$$..$$`, wrapped
  lines) is centered on the window like `mdv`'s, when its rows (grown ones included) hold nothing else.
  A line-number gutter may sit to the left; the math is centered in the rest. Otherwise (a split, text
  beside `$$..$$`) it keeps its source position, since the overlay is opaque.
- Verified by screenshot with `cat` (block, one-line, indented list block, shared row, wrapped line) and nvim.

## 2026-11-12: markdown tables in auto-detect
- `tableAt` in `automath.js`: same rules as `mdv` (a row with `|`, a `TABLE_SEP` row, then rows while they
  contain `|`), with an editor's line-number gutter taken from the separator row. Drawn by `makeTable` as an
  HTML table over exactly its source rows: the header takes the header and separator rows, then one row per
  body row, borders on cell edges (`--dim`). Scaled down if it doesn't fit.
- Cells: `splitCells` (no split inside `$..$`, `` `..` `` or on `\|`), `cellHtml` (math, code in the theme's
  yellow like `mdv`, bold, italic, strikethrough).
- Cursor anywhere in the table shows the whole table as source. A soft-wrapped row leaves it as source.
- Verified by screenshot with `cat` and nvim (`set number`), including alignment, math and fractions in
  cells, an escaped `\|` line and `a | b` staying text. `docs/nvim.png` regenerated (shows the table).

## 2026-11-12: Cmd-F find
- Find bar (`@xterm/addon-search`, vendored like the other addons): incremental, Enter / Shift-Enter to
  step, Esc to close, match count. The addon marks the active match by *selecting* it, and the selection
  is drawn over its decorations; with focus in the find box that's the inactive selection, so its color
  is set to the active-match orange while the bar is open.
- Cmd-W (close window) and Ctrl-Cmd-F (full screen) come from Tauri's default macOS menu (File, View);
  xterm doesn't consume Cmd combos, so they reach it. Not pressed in testing (no keyboard in shot mode).
- Fn-F: the web view takes the key before macOS can map it to the menu's Enter Full Screen, and WebKit
  doesn't expose Fn to the page (a JS `getModifierState('Fn')` check never fired). `fn_f_fullscreen` in
  `main.rs` installs an AppKit local key monitor that toggles full screen on Fn-F and swallows the key.
- Ctrl-D not closing was the user's zsh, not mathterm: vi mode binds `^D` to `list-choices` in viins.
  `bindkey -M viins '^D' delete-char-or-list` restores exit-on-empty-line. Shell exit does close its window
  (checked with `exit`).

## 2026-11-12: Cmd-N new window, focus on launch
- One shell per window: `Session` is a map keyed by window label, and `write`/`resize`/`foreground` act on
  the calling window. Output is sent with `emit_to` to its own window, and the frontend listens through
  `getCurrentWebviewWindow().listen` (a global `listen` also receives events sent to other windows).
- A shell exiting closes only its window (the app quits after the last one); closing a window drops its
  pty, which hangs up the shell. New windows cascade 24px down-right from the current one.
- Gotchas: `capabilities/default.json` listed only `"main"`, so new windows couldn't call `start` (no shell,
  no error shown); now `"*"`. New windows need `background_throttling(Disabled)` like the config's window,
  or an off-screen window stops painting while another exists (broke shot mode).
- The terminal takes focus on launch and when the window regains focus.
- Verified with a temporary hook opening a second window in shot mode: two shells on separate ttys, and
  the main window shows only its own output. Cmd-N itself and closing windows weren't exercised.

## 2026-11-12: real Mac app
- `npm run app`: `tauri build` (`.app` bundle only) and copy to `/Applications`. Ad-hoc signed
  (`signingIdentity: "-"`), so it runs on this machine; distributing it would need a Developer ID + notarization.
- `mdv` ships as a resource (`Contents/Resources/bin`). Release builds put that on PATH; debug builds keep
  the source tree's `bin/` so edits apply without a rebuild.
- `LANG=en_US.UTF-8` when unset: apps started from Finder get no LANG and zsh/nvim fall back to ASCII.
- **Release-only CSP bug:** Tauri adds hashes for the page's inline `<style>` to the CSP in release builds,
  and with hashes present browsers ignore `'unsafe-inline'`, so the `<style>` elements xterm creates at
  runtime were blocked (black Times text, broken KaTeX). `dangerousDisableAssetCspModification: ["style-src"]`.
  Dev builds don't do this, so check `npm run app` output after touching styles or the CSP.
- Icon: `make_icon.py` also writes `icon.icns` (via `iconutil`).
- Verified with the release binary under `env -i` (Finder-like env): bundled `mdv` found, LANG set, UTF-8
  and math render.

## 2026-11-11: lineHeight config, lone-row overflow, README screenshots
- `"lineHeight"` in config.json (default 1.2).
- Auto-detect: one-row inline math may overflow its row by 10% (`LONE_OVERFLOW`) when neither neighbor row
  has math. KaTeX's parens are taller than a text row, so at 1.0 even `f(x)` shrank to ~0.86. With math on a
  neighbor row it stays at `INLINE_OVERFLOW` (1.0): a global 1.1 made `\frac{a}{b}` collide with the `\sum^n`
  on the next row, and the lower overlay's background clipped it. `mdv` keeps 1.0.
- README: Claude Code screenshot (`docs/claude-code.png`, taken by the user), regenerated `demo.png`/`nvim.png`.
- `shot:docs` nvim shot was blank: `.ready` was touched before nvim started, so the capture beat nvim's
  first draw. Now `(sleep 3; touch ...) & disown; nvim ...`. Gotcha: `&!` doesn't work there; the INIT
  is typed into interactive zsh, which history-expands the `!`.

## 2026-11-11: close gaps after inline math
- **Joined rows** (`joinRows`/`makeJoined` in `automath.js`): on a row where one-row matches are followed by
  more text, one overlay covers it from the first match to the end of its text (or a `│` split). Each
  formula is drawn at its fitted width and the text between and after is redrawn right behind it, with each
  cell's colors, bold/italic/underline/dim. Real cells stay underneath for selection and copy. Rows with
  nothing after the math keep the per-match overlay.
- `grow()` checks rows above/below from the row's leftmost match, since later math on a joined row shifts left.
- **KaTeX font bug (older than this):** KaTeX's `@font-face` fonts load lazily on first use, so overlays built
  before that were measured with fallback glyphs and kept the wrong size (they're cached). WebKit here never
  fires `loadingdone`. `renderer.js` now loads every KaTeX face at startup (`katexFonts`); auto-detect rebuilds
  its overlays when that resolves. Before, the error just disappeared into the gaps.
- Gotcha: redrawn text needs `white-space: pre`; `nowrap` strips each run's leading space.
- Verified by screenshot: `\operatorname{Re}(s) = 1`, `\mathbb{C}`, `\sigma`/`\gamma` mid-sentence and colored/bold/
  italic text after math all sit flush.

## 2026-11-11: scroll flicker, `\cmd!` unescape
- Cursor-row skip only applies while the cursor is visible (DECTCEM `?25h/l`, tracked by a CSI handler since
  xterm doesn't expose it). TUIs like Claude Code hide it while redrawing, so their rows no longer flip raw.
- Scan runs synchronously in `onRender` (inside xterm's paint frame) instead of the next rAF, so overlays
  never lag scrolled text by a frame.
- Overlays are keyed without position and moved on scroll instead of rebuilt.
- Fence state starts from up to 200 rows above the viewport (`FENCE_LOOKBACK`; normal buffer only).
- **`$$` pairing (the actual cause in the user's screenshot):** the viewport's top row was the *closing* `$$` of a
  block that started off-screen. It paired with the next opener, shifting every pair below: prose was
  taken as block bodies (KaTeX rejects them, so raw) and the real bodies were skipped. `pairBlocks` now
  pairs both ways (first `$$` as opener, or as a stray closer) and keeps the pairing whose bodies parse.
- `\sin!` / `O!` -> `\sin\!` / `O\!` (`unstrip`): Claude Code drops the backslash of `\!`.
- Verified by screenshot: hidden-cursor row typeset, `\sin!\left(` renders without "!", and a recreation of
  the user's screen (alt screen, viewport starting inside a block) renders every block and inline span.
- Seen, not fixed: glyphs of the source text can overhang the overlay's left edge by ~1px (a faint bar left
  of an indented block).

## 2026-11-11: auto-detect ignore list
- `autoDetectIgnore` globs in config.json (default `*.tex`, `*.sty`, `*.cls`: LaTeX sources usually have a PDF
  next to them). Matched against the foreground process's arguments and the window title. The status bar
  says "auto math paused for hw7.tex" when it kicks in.
- New Rust command `foreground` (cached `ps` lookup of the pty's foreground process group).
- Verified: identical content in `notes.tex` stays raw in nvim, and `notes.md` is typeset.

## 2026-11-11: README leads with auto-detect
- Auto-detect is the main feature. OSC 7777 is effectively `mdv`'s private channel (nothing else sends it),
  so the README now presents `mdv` + OSC 7777 as an add-on for exact layout. New lead screenshot
  `docs/nvim.png` (nvim editing `demo.md`); `npm run shot:docs` produces both images.
- Direction: build new features on auto-detect. Keep OSC 7777 for what detection can't do (exact layout
  in `mdv`, `raw` spans for `mdv`'s code, resize-proof `rule`s), but don't extend it. If it ever needs to
  shrink: `mdv` could drop `draw`/query, print plain `$..$` with blank rows around display math for
  detection to grow into, and remove ~200 lines of decoration code. The cost is gaps after inline math.

## 2026-11-11: color schemes, zoom
- `ui/themes.js` with `default` and `catppuccin-mocha`. Config file selects one, or supplies a custom ITheme.
  All self-drawn UI (math overlays, rules, status bar, auto-detect colors) follows the theme via CSS variables.
- Cmd-+ / Cmd-- / Cmd-0 zoom, re-laying out math at the new cell size.
- Single shared key handler (`keyBindings`); auto-detect's toggle moved onto it.
- Shot hook: waits for `$MATHTERM_SHOT.ready`; INIT typed 1.5s after the shell starts (see [dev.md](dev.md)).
- Verified with screenshots: Mocha colors on `mdv demo.md`, and font size 20 via config (the same
  `setFontSize` path the zoom keys use). The keys themselves were not exercised (no keyboard in shot mode).

## 2026-11-11: less cramped
- Terminal `lineHeight: 1.2` (was 1.0): more air between text rows, and taller rows give math more height
  without taking extra rows. All sizing reads the cell size from the DOM, so nothing else changed.
- Math that grew into neighboring rows keeps `GROW_MARGIN` (0.25 row) clear at top and bottom, so it no
  longer touches the surrounding text.
- **Inline math is fitted by ink height, not line box** (`inkBox`/`fitInk` in `renderer.js`). KaTeX's line box
  is ~22px even for a plain `x` (line-height 1.2), taller than a 19px row, so with the taller rows
  everything measured as "slightly tall": nested fractions stopped counting as tall and spilled into
  neighboring lines. The union of KaTeX's `.strut` rects is the exact height + depth. Inline math is now
  scaled so its ink fits its row (`INLINE_OVERFLOW` 1.25 -> 1.0) and centered by ink, not by box. Used by
  `measure()`, inline `draw`, and auto-detect overlays (multi-row `$$` blocks still fit by box).

## 2026-11-11: math grows into empty rows, soft-wrapped matches
- In Claude Code, display math is one `$$..$$` line between blank lines, so it got 1 row and rendered at
  ~1/3 size (user screenshot). Matches now grow into up to 3 empty rows above/below (`grow()`). Shared gaps
  are split so neighbors never overlap.
- Matches spanning soft-wrapped rows are detected when they're alone on those rows (long display lines).
- Tested with a Claude-Code-style transcript (`cat`): `\underbrace`, sums with limits, integrals and a
  wrapped display line all render near full size.

## 2026-11-11: auto-detect mode
- New `ui/automath.js`: typesets LaTeX found anywhere on screen, with no program cooperation. Verified with
  `cat demo.md` (inline, multi-row `$$` blocks, math in table cells; `$5`/`$10` untouched) and with
  `nvim --clean -c 'set number' demo.md`: line numbers are handled, math takes nvim's background, the
  cursor's row and a `$$` block containing the cursor show source.
- New `OSC 7777;raw;<len>`: `mdv` marks code spans and code-block lines literal, because its styled code has
  no backticks for auto-detect to recognize. Without it, `$x$` in code was typeset.
- Shot hook takes the capture at 6s (was 5s): `sleep 3` in `MATHTERM_INIT` plus shell startup could miss it.

## 2026-11-11: tables, syntax highlighting, clickable links
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

## 2026-11-11: rough edges: tall overlap, rules, screenshots
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

## 2026-11-11: tall inline math, resize re-placement
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

## 2026-11-11: markdown styling in mdv
- `mdv` styles headings (h1 magenta with a rule, h2+ blue), bold, italic (`*` and `_`, but not snake_case),
  strikethrough, inline code, fenced code blocks (fences dropped, indented), lists (`•`), quotes (`│`),
  horizontal rules, links (`text (url)`) and images (`[image: alt]`).
- Code spans and code blocks are never math (`` `$x$` `` stays code).
- It now also styles in other terminals, leaving math as LaTeX source there. Redirected output is still unchanged.
- Display math reuses the source's line breaks, so there are no extra blank lines around `$$..$$`.
- `npm run shot` captures by window id (`-l`, via `objc2` for `windowNumber`) after focusing the window.
  The `-R` rect capture had picked up the app switcher and other windows.
- Demo and `docs/demo.png` updated to show every style.

## 2026-11-11: inline overflow, README
- Inline math may now spill 25% past its row (`INLINE_OVERFLOW` in `renderer.js`) before shrinking, so
  superscripts like `e^{i\pi}` render at text size. Fractions still shrink (~0.6x); see plan 1.
- `npm run shot` raises the window (always-on-top) before capturing. Without it the window could open
  behind other apps, and `screencapture -R` would grab whatever was on top.
- Added `README.md` and `docs/demo.png`. Added an inline fraction line to `demo.md`.

## 2026-11-11: ported Electron -> Tauri
- Replaced `main.js` / `preload.js` with `src-tauri/src/main.rs` (`portable-pty`). Dropped `electron` and `node-pty`
  (and the `spawn-helper` chmod workaround).
- Frontend moved to `ui/`. Libraries are vendored there because Tauri serves a single directory.
- Shell spawn is now triggered by the frontend (`start`) with its real size instead of a fixed 80x24.
- `npm run shot` now captures only the window rect (the Electron version used `capturePage`).
- Verified: the size query round-trips (display `\int..` measured 11 cols vs 18 guessed), and the demo renders the same in WebKit.

## 2026-11-11: measured sizing
- Added the query/reply step: the terminal renders KaTeX into a hidden probe and reports its size in cells.
  This replaced the length-based guess, so inline math has no gaps.
- `draw` now carries an explicit `i|d` mode (it used to be inferred from `rows > 1`).
- Display math is centered by `mdv` padding the line (width is now exact).
- `mdv` only renders when stdout is a tty, so `mdv f.md > out` stays clean.
- `mdv` rewritten as a single tokenize pass, with tests on a fixed sizer.

## 2026-11-11: initial draft
- Electron + xterm.js + node-pty + KaTeX, OSC 7777 draw with sender-guessed sizes, `mdv`.
