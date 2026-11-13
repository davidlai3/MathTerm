# Plans / known issues

Roughly in priority order:

## Terminal basics

- **tmux split windows: fixed for side-by-side panes** (see [changelog.md](changelog.md)). Left: vertical
  borders inside one half of a top/bottom split, fences/blocks across a horizontal split (rows above and
  below a `─` border are still one column range), and `mdv`'s OSC 7777 through tmux (needs
  `allow-passthrough on` and DCS-wrapped sequences).

## Performance

- **User report: scrolling a Claude Code chat with LaTeX is noticeably slower** than without it. Not measured
  yet. First step: time `scan()` and `makeOverlay` (`performance.now()`, behind a debug flag, shown in the
  status bar), and count overlays built vs moved per frame, while scrolling a long chat.
- Likely costs, in rough order (all hypotheses until measured):
  1. *Scan blocks the paint.* `scan()` now runs synchronously in `onRender` (so overlays never lag the text),
     so every scroll frame pays for the whole scan before it can paint. The queued rAF scans from `onScroll` /
     `onCursorMove` can run a second full scan in the same frame. At minimum skip the queued scan when the
     sync one already ran for that frame.
  2. *Layout thrash when overlays are built.* Each new overlay is inserted and then measured
     (`getBoundingClientRect` in `fitInk`/`inkBox`/`makeJoined`/`makeTable`), forcing a synchronous layout per
     overlay. While scrolling, rows coming into view build several per frame. Fix: insert all new overlays
     first, then measure them all, then write all transforms (one layout instead of N). Could also cache the
     measured size per `tex` + cell size, since the same equation is measured again every time it scrolls
     back into view.
  3. *Reading every cell every frame.* `rowCells` calls `getCell`/`getChars` for every cell of every row
     (~10k calls on a large window), and `joinRows` again with `cellColor` for trailing text. Fix: cache each
     row's parsed result and reuse it while the row's text is the same (`translateToString` per row as
     the key is cheaper than per-cell reads), or only rescan rows xterm reports as changed (`onRender`'s
     `start`/`end`).
  4. *Fixed costs per scan:* the 200-row fence lookback (`translateToString` per row, normal buffer only),
     `pairBlocks` run twice, and `grow`/`centerDisplay` reading neighbor rows. Small each, but paid on every frame.
  5. *Moving overlays.* Reused overlays move via `left`/`top`, which triggers layout. `transform:
     translate()` would keep it to compositing.
  6. *DOM weight.* Each overlay is a full KaTeX tree. A long chat with many equations on screen means
     thousands of nodes repositioned per scroll step.
- Budget: a scan should stay well under a frame (~2-3 ms) on a full-screen window, so a scroll frame
  with no new equations costs nearly nothing.

## Auto-detect: remaining work

The mode exists (see [auto-detect.md](auto-detect.md)). Still to do:

- **Scroll flicker in Claude Code: fixed for `$$` blocks cut off at the top** (see [changelog.md](changelog.md)). Still open: a
  block cut off at the top shows its partial body raw; a `\[` block whose `\[` is off-screen; on the alt
  screen there's no scrollback to recover fence state from.
- **BUG (user report, screenshot): Claude Code strips backslash escapes before punctuation.** Its markdown
  renderer treats `\,` `\!` `\;` `\{` `\}` `\\` as escapes, so `\sin\!\left(` arrives as `\sin!\left(`, and
  `\frac12 s(s-1)\,\pi^{-s/2}` arrives as `...(s-1),\pi...` (rendered as a literal "!" and ","). This answers the
  open question about Claude Code: text-mode `$..$` and `$$..$$` survive, but punctuation escapes don't.
  `\cmd!` is now restored to `\cmd\!`. `\underbrace{a}{b}` (its `_` eaten as `_italic_`) gets its `_` back, and `,` beside
  `\times`/`\cdot` becomes `\,`. `\,` `\{` `\\` are left alone (`,\alpha` and `{x}` are often meant
  literally). Worth asking whether Claude Code can be told not to unescape inside math.
- **Gaps after inline math: fixed by joined rows, and by reflow on soft-wrapped lines** (see [changelog.md](changelog.md)).
- **Claude Code, partly verified** (user screenshot): one-line `$$..$$` display math survives its markdown
  rendering with backslashes and `_` intact. Still unchecked: inline `$..$` and `\(..\)`. In that sample the
  model wrote inline math as Unicode (`Yₙ`) rather than LaTeX.
- **Tables:** a soft-wrapped table row (narrow window) leaves the table as source. Cell fractions are
  cramped in a one-row cell (the table is scaled to fit, not given more rows).
- **Code without fences.** TUIs that render code blocks without backticks (Claude Code included) give no hint,
  so `$var$`-like text inside them can be typeset. Possible heuristic: skip rows whose cells share a
  code-block background color.
- **Tight fit.** Inline math with text directly above and below has only its row.
- Stacked equations with no blank row between them get no extra room and stay small. Wrapped inline math
  (sharing rows with prose) is still skipped.

## Goal: full live preview

Auto-detect typesets math in the editor itself. For a fully styled page (headings, tables) beside the editor:

1. **`mdv --watch <file>`.** Re-render on change, on the alternate screen so each frame replaces the last.
   Needs a protocol op to clear drawn items (`OSC 7777;clear`).
2. **Native splits in mathterm.** Editor on one side, preview on the other. tmux isn't a shortcut: it
   swallows unknown OSCs and repaints the whole screen, which breaks line-anchored overlays.
3. **Tiny nvim plugin, only if needed.** E.g. send the buffer on `TextChanged` so the preview updates per
   keystroke rather than per `:w`, sync scroll, or hide math for all of insert mode.

## Smaller items

1. **Markdown gaps.** Tables wider than the window wrap and break their borders (could shrink columns or
   wrap cell text). Escaped `\|` in table cells isn't handled. Bare URLs aren't clickable (xterm's web-links
   addon would do it). Nested blockquotes, numbered-list styling and footnotes print mostly raw.
2. **Line wrap.** Auto-detect: fixed for soft wraps (reflow, see [changelog.md](changelog.md)). Not handled:
   programs that wrap with real newlines (Claude Code's own wrapping), where `$x+` / `y$` never match.
   Untested there. In `mdv`, such math is clipped; `mdv` could wrap the text itself.
3. **Selection / copy.** Copying a math region yields spaces. Could put the LaTeX source on the clipboard.
4. **`tex` one-liner** (`tex '\sqrt{2}'`) and a shell hook so normal command output can contain math.
5. Later: tabs/splits (covered by the live-preview goal above).
