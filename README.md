# mathterm

A terminal that typesets LaTeX. Math is rendered with KaTeX as real vector text, the same way Obsidian
or a browser shows it, not as Unicode approximations or pasted-in images.

![mathterm rendering a markdown file with inline and display math](docs/demo.png)

## How it works

mathterm is a normal terminal (xterm.js in a Tauri window, your login shell in a pty) that understands
one extra escape sequence, **OSC 7777**. A program prints the LaTeX inside that sequence, and the
terminal draws the typeset math over the cells the program reserved. A query form lets the program ask
how many cells an expression needs first, so the layout is exact.

The included `mdv` tool uses this to print styled markdown files with their `$...$` and `$$...$$` math rendered.
Any program can do the same. See [NOTES.md](NOTES.md#protocol-osc-7777) for the protocol.

## Install and run

Requires macOS, Node, Rust (`brew install rust`) and Python 3. Optional: `pip3 install pygments` for
better syntax highlighting in code blocks.

```sh
npm install
npm start
```

## Usage

Inside mathterm, `mdv` is on your `PATH`:

```sh
mdv notes.md                         # print a styled markdown file with its math rendered
echo 'Euler: $e^{i\pi}+1=0$' | mdv   # or read from stdin
```

Links are clickable: hover to see the URL, Cmd-click to open it.

**Auto-detect:** LaTeX in *any* program's output is typeset too. That includes `cat notes.md`, Claude
Code's replies, and math inside nvim while you edit, where the line under the cursor shows the source
so you can change it. Cmd-Shift-M toggles it.

In other terminals `mdv` still styles the markdown and leaves the math as LaTeX source.
With output redirected (`mdv f.md > out`) it prints the file unchanged.

## Status

Early prototype. What works:

- Inline and display math in markdown, sized by the terminal. Display math is centered, and tall inline
  math (nested fractions, sums with limits) gets extra line spacing.
- Math and rules follow their text when the window is resized and lines re-wrap.
- Markdown styling: headings, bold/italic/strikethrough, inline code, lists, quotes, rules.
- Tables with borders and column alignment (math in cells is sized correctly).
- Syntax-highlighted code blocks (pygments if installed, otherwise a built-in highlighter).
- Clickable links.
- Auto-detect mode: typesets `$...$`, `$$...$$`, `\(...\)` and `\[...\]` found anywhere on screen, with
  editor-friendly behavior (cursor line shows source, code is skipped).
- `$5`-style dollar amounts, code spans and code blocks are never treated as math.

Known gaps:

- Tables wider than the window wrap and break their borders. Long lines aren't re-wrapped.
- Text printed before a resize keeps its original line spacing. For example, tall inline math shrinks to
  one row instead of gaining space if its line re-wraps.

## Roadmap

- **Auto-detect polish:** verify against Claude Code's markdown rendering, and skip code blocks that TUIs
  draw without backticks.
- **Live preview:** `mdv --watch` in a split pane, for the fully styled page beside your editor.

The full plan and changelog are in [NOTES.md](NOTES.md).
