# Auto-detect mode (`ui/automath.js`)

For programs that never send OSC 7777 (Claude Code, `cat`, nvim while editing). On by default; Cmd-Shift-M toggles.

- After every render, scroll, resize or cursor move (coalesced to one per animation frame), every viewport row is
  read cell by cell (with a string-index to cell-column map, so wide characters line up) and matched for
  `$..$`, `$$..$$`, `\(..\)`, `\[..\]` with `mdv`'s `$` rules. Rows that are only `$$` or `\[` (optionally
  after an editor line number) open a multi-row block, up to 30 rows.
- **Panes:** full-height vertical `│` borders (tmux, editor splits) split the screen into column ranges that
  are scanned separately (`paneRanges`, `findIn`). Inside a pane, a row reaching the pane's edge continues
  on the next row.
- **Display math** is centered on the window when nothing else shares its rows (`centerDisplay`).
- **Growing:** a match may take up to `MAX_GROW` (3) empty rows above and below it (empty under its columns,
  not the cursor row, not another match). Display math uses all of them; inline math grows symmetrically so
  it stays centered on its text row. Grown math keeps `GROW_MARGIN` (0.25 row) clear top and bottom.
  A gap shared by two matches is split (upper gets floor(gap/2)). This is
  what makes Claude Code's one-line `$$..$$` (between blank lines) render near full size instead of 1 row.
- **Soft wraps:** rows are joined with their `isWrapped` continuations before matching. A match spanning rows
  is accepted only if nothing else is on those rows (true for a long display line), and it then covers them
  full-width, keeping the source indent.
- A match becomes an absolutely positioned overlay covering the source's cells (plus grown rows), using the source cell's
  foreground/background (default palette, 256-color cube or RGB, honoring inverse). Math is scaled to fit,
  with inline allowed `INLINE_OVERFLOW`.
- Skipped: the cursor row, and any block containing it (so you can edit the source); rows inside ``` fences
  (tracked from the top of the viewport); matches inside `inline code` (odd backtick count before them);
  cells marked `raw`; anything KaTeX fails to parse; matches crossing `│` (editor splits).
- **Ignore list** (`autoDetectIgnore`, default `*.tex`, `*.sty`, `*.cls`): detection pauses while the
  foreground program's command line, or the window title, has an argument whose basename matches a glob.
  The terminal can't see which file an editor has open, so it asks: the Rust `foreground` command gets the
  pty's foreground process group (`process_group_leader`) and runs `ps -ww -o args=` only when that pid
  changes. The frontend polls every 500ms. The title covers nvim's `:e` to another file when `set title` is on.
  Limits: a file opened later without `set title` isn't seen. Output already printed (e.g. `cat x.tex`) is
  rendered again once the shell is back in the foreground. It pauses the whole screen, not regions.
- Overlays are keyed by position + tex + colors + cell size and diffed each scan. KaTeX HTML is cached by
  tex, so steady screens and blinking cursors cost only the row scan.
