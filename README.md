# mathterm

A terminal that typesets LaTeX. Math is rendered with KaTeX as real vector text, the same way Obsidian
or a browser shows it, not as Unicode approximations or pasted-in images.

![mathterm rendering a markdown file with inline and display math](docs/demo.png)

## How it works

mathterm is a normal terminal (xterm.js in a Tauri window, your login shell in a pty) that understands
one extra escape sequence, **OSC 7777**. A program prints the LaTeX inside that sequence, and the
terminal draws the typeset math over the cells the program reserved. A query form lets the program ask
how many cells an expression needs first, so the layout is exact.

The included `mdv` tool uses this to print markdown files with their `$...$` and `$$...$$` math rendered.
Any program can do the same. See [NOTES.md](NOTES.md#protocol-osc-7777) for the protocol.

## Install and run

Requires macOS, Node, Rust (`brew install rust`) and Python 3.

```sh
npm install
npm start
```

## Usage

Inside mathterm, `mdv` is on your `PATH`:

```sh
mdv notes.md                         # print a markdown file with its math rendered
echo 'Euler: $e^{i\pi}+1=0$' | mdv   # or read from stdin
```

Outside mathterm, or with output redirected, `mdv` prints the file unchanged.

## Status

Early prototype. What works:

- Inline and display math in markdown, sized by the terminal and centered.
- `$5`-style dollar amounts and fenced code blocks are left alone.

Known gaps:

- Inline fractions render small, because inline math stays within one row (+25%).
- Markdown other than math prints raw.
- Resizing the window misplaces math that's already on screen.

The full plan and changelog are in [NOTES.md](NOTES.md).
