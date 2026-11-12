# mathterm notes

A terminal that typesets LaTeX natively (KaTeX, vector text) instead of approximating it with Unicode or images.
The main feature is auto-detect (any program's output). `mdv` + OSC 7777 is an add-on for exact layout.

| File | What's in it |
|---|---|
| [notes/architecture.md](notes/architecture.md) | Source files and what each does; config, themes, zoom, keybindings |
| [notes/auto-detect.md](notes/auto-detect.md) | How auto-detect finds, sizes and draws math and tables |
| [notes/protocol.md](notes/protocol.md) | OSC 7777, `mdv`'s private escape sequence |
| [notes/dev.md](notes/dev.md) | Building, the screenshot hooks, gotchas |
| [notes/plans.md](notes/plans.md) | Known issues and plans, roughly in priority order |
| [notes/changelog.md](notes/changelog.md) | What changed and why, newest first |
