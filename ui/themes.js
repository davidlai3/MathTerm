// Built-in color schemes, in xterm.js ITheme form. Pick one with "theme" in ~/.config/mathterm/config.json,
// or set "theme" to an object with these same keys to use any other scheme.
const THEMES = {
  default: {
    foreground: '#ffffff', background: '#1e1e1e', cursor: '#ffffff', cursorAccent: '#1e1e1e',
    selectionBackground: '#4d4d4d',
    // xterm.js's own default palette (Tango)
    black: '#2e3436', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000',
    blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#d3d7cf',
    brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#8ae234', brightYellow: '#fce94f',
    brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#34e2e2', brightWhite: '#eeeeec',
  },
  // https://github.com/catppuccin/catppuccin (Mocha flavor, terminal mapping from catppuccin's ports)
  'catppuccin-mocha': {
    foreground: '#cdd6f4', background: '#1e1e2e', cursor: '#f5e0dc', cursorAccent: '#1e1e2e',
    selectionBackground: '#585b70',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
    brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
  },
};

// The 16 ANSI colors of a theme, in index order (0-15), for code that resolves palette indexes itself.
const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
