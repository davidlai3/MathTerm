# mathterm

A terminal that typesets LaTeX. Any `$...$` that shows up on screen is rendered with KaTeX as real
vector text, the same way Obsidian or a browser shows it. That includes `cat` output, Claude Code's
replies, and the file you're editing in nvim. No plugins, and no cooperation from the program.

![nvim editing a markdown file in mathterm: the math is typeset in place, the cursor line shows its source](docs/nvim.png)

## How it works

mathterm is a normal terminal: xterm.js in a Tauri window, with your login shell in a pty. After every
redraw it scans the visible text for `$...$`, `$$...$$`, `\(...\)` and `\[...\]`. It then lays typeset
math over the cells where the source sits, in the source's own colors.

- **Editors:** the line under the cursor (or a `$$` block containing it) shows the raw LaTeX, so you can
  edit it, like Obsidian's live preview. Line numbers and splits are handled.
- **Room to breathe:** display math grows into the blank lines around it, which is how Claude Code and most
  markdown lay out equations, so it renders at full size instead of being squeezed into one row.
- **Few false positives:** `$5 and $10` stays text, code fences and `` `inline code` `` are skipped, and
  anything KaTeX can't parse is left alone.
- **Copy works:** the cells still hold the source, so copying an equation gives you its LaTeX.

Cmd-Shift-M toggles detection.

## Install and run

Requires macOS, Node, Rust (`brew install rust`) and Python 3.

```sh
npm install
npm start
```

## Config

`~/.config/mathterm/config.json`:

```json
{ "theme": "catppuccin-mocha", "fontSize": 14, "fontFamily": "Menlo, monospace" }
```

Built-in themes are `default` and `catppuccin-mocha`. `theme` can also be an object with xterm.js theme
keys (`background`, `foreground`, `black` ... `brightWhite`) to use any other scheme.

| Keys | |
|---|---|
| Cmd-+ / Cmd-- / Cmd-0 | Zoom in / out / reset |
| Cmd-Shift-M | Toggle math detection |
| Cmd-click | Open a link (hover shows the URL) |

## Add-on: `mdv`, a markdown viewer

Detection can only use the space a program already left for the math, so inline math can leave a gap
where its source was wider. `mdv` is a small viewer (Python, stdlib only) that lays the page out itself:

```sh
mdv notes.md                         # styled markdown with typeset math
echo 'Euler: $e^{i\pi}+1=0$' | mdv   # or read from stdin
```

![mdv rendering a markdown file: headings, inline and display math, a table, highlighted code](docs/demo.png)

- Headings, bold/italic/strikethrough, lists, quotes, rules and clickable links.
- Tables with borders and alignment, sized correctly around math in cells.
- Syntax-highlighted code blocks (`pip3 install pygments` for better lexers; there's a built-in fallback).
- Exact math layout: no gaps after inline math, tall inline math gets its own spacing, and display math
  is centered.

`mdv` talks to mathterm through **OSC 7777**, a small private escape sequence for asking how big an equation
renders and drawing it in space the program reserved. The details are in
[NOTES.md](NOTES.md#protocol-osc-7777). In other terminals `mdv` still styles the markdown and leaves the
math as source. With output redirected (`mdv f.md > out`) it prints the file unchanged.

## Status

Early prototype, macOS only. Known gaps:

- Detected inline math can't take more room than its source: a gap is left after it, and tall inline math
  with text directly above and below is shrunk to fit its row.
- TUIs that draw code blocks without backticks (Claude Code does) can get `$var$`-like text typeset.
- In `mdv`, tables wider than the window wrap and break their borders.

## Roadmap

- **Detection polish:** check Claude Code's handling of inline `$...$` and `\(...\)`, and recognize code
  blocks drawn without backticks.
- **Live preview:** `mdv --watch` in a split pane, for the fully styled page beside your editor.

The full plan and changelog are in [NOTES.md](NOTES.md).
