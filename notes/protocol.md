# Protocol: OSC 7777

```
query:  ESC ] 7777 ; ? ; <i|d> ; <latex> BEL           (program -> terminal)
reply:  ESC ] 7777 ; = ; <cols> ; <rows> BEL            (terminal -> program, on its stdin/tty)
draw:   ESC ] 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL
rule:   ESC ] 7777 ; rule ; <h1|hr> BEL                 (full-width line on the current row)
raw:    ESC ] 7777 ; raw ; <len> BEL                    (next len cells are literal: never auto-detected)
```

- `i` = inline, `d` = display.
- Inline `rows` is 1 (its ink fits the row) or 3 ("tall": scale would drop below
  `TALL_SCALE` = 0.85, so the sender puts a blank line above and below that line and the math is drawn
  centered on its row with up to 3 rows of height). On every placement the terminal checks that the rows
  above and below are empty under the math; if not (e.g. wrapped text after a resize), it fits one row.
- Display math is centered by the terminal (x is ignored), which keeps it centered after a resize.
- Links are standard OSC 8 hyperlinks (`ESC ] 8 ;; url ESC \ text ESC ] 8 ;; ESC \`). mathterm shows the URL in a
  status bar on hover and opens it on Cmd-click via the `open_url` command, which only accepts `https://`,
  `http://` and `mailto:` (links can come from any program's output).
- `raw` spans are anchored like drawn math (marker + offset, so they survive re-wrap). `mdv` sends one before
  every code span and code-block line.
- `rule` lines are drawn by the terminal at the current width, so they never wrap. Outside mathterm,
  `mdv` falls back to `═`/`─` characters.
- `draw` overlays KaTeX on a `cols x rows` box at the cursor. The **sender** reserves the space:
  spaces after an inline draw, newlines after a display draw. The terminal never moves the cursor.
- LaTeX must not contain newlines, ESC or BEL (mdv collapses whitespace).
- Replies arrive in query order. `mdv` sends all queries in one batch, reads replies from `/dev/tty` in raw
  mode with a 1s timeout, and falls back to guessed sizes if they don't all arrive.
