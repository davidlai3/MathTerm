const { invoke } = window.__TAURI__.core;
const pty = {
  write: (data) => invoke('write', { data }),
  resize: (cols, rows) => invoke('resize', { cols, rows }),
};

const term = new Terminal({
  allowProposedApi: true,
  fontFamily: 'Menlo, monospace',
  fontSize: 14,
  lineHeight: 1.2, // breathing room for text, and taller rows for math to grow into
  theme: THEMES.default,
  // OSC 8 hyperlinks: show the target on hover, open with Cmd-click (plain clicks still select text)
  linkHandler: {
    activate: (e, uri) => { if (e.metaKey) invoke('open_url', { url: uri }); },
    hover: (_, uri) => { statusBar.textContent = `${uri}  ·  ⌘-click to open`; statusBar.hidden = false; },
    leave: () => { statusBar.hidden = true; },
  },
});
const statusBar = document.getElementById('status');
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));
// GPU renderer: the default DOM renderer rebuilds every row as spans on each scroll step, on the same thread
// as the math overlays. If the WebGL context is lost (or never created), xterm falls back to the DOM renderer.
// Loaded from applyConfig: `"renderer": "dom"` keeps the DOM renderer (a stale-rows bug in nvim is suspected
// to be WebGL's, not yet reproduced).
function useWebgl() {
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (e) {
    console.warn('WebGL renderer unavailable, using DOM renderer', e);
  }
}
// Type right away: on launch, and when switching back to the window (Cmd-Tab), without clicking in first.
term.focus();
// No WebKit context menu (Spelling, Font, AutoFill... for xterm's hidden textarea). Programs with mouse
// reporting (tmux) still get the right click.
document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('focus', () => (findBox.hidden ? term : findInput).focus());

// Cmd-F: find in scrollback. Enter / Shift-Enter step through matches, Esc closes.
const search = new SearchAddon.SearchAddon();
term.loadAddon(search);
const findBox = document.getElementById('find');
const findInput = findBox.querySelector('input');
const findCount = findBox.querySelector('.count');
// The addon marks the active match by selecting it, and the selection is drawn over decorations. Focus is in
// the find box, so that's xterm's *inactive* selection: it's made orange while the box is open.
const ACTIVE_MATCH = '#d08770';
const FIND_OPTS = { decorations: { matchBackground: '#6b5a24', matchOverviewRuler: '#6b5a24',
  activeMatchBackground: ACTIVE_MATCH, activeMatchColorOverviewRuler: ACTIVE_MATCH } };
const setActiveMatchColor = (c) => { term.options.theme = { ...term.options.theme, selectionInactiveBackground: c }; };
search.onDidChangeResults(({ resultIndex, resultCount }) => {
  findCount.textContent = !findInput.value ? '' : resultCount ? `${resultIndex + 1}/${resultCount}` : 'none';
});
function openFind() {
  setActiveMatchColor(ACTIVE_MATCH);
  findBox.hidden = false;
  findInput.focus();
  findInput.select();
}
function closeFind() {
  setActiveMatchColor(undefined);
  findBox.hidden = true;
  search.clearDecorations();
  term.focus();
}
findInput.addEventListener('input', () => {
  if (findInput.value) search.findNext(findInput.value, { ...FIND_OPTS, incremental: true });
  else { search.clearDecorations(); findCount.textContent = ''; }
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFind();
  else if (e.key === 'Enter' && findInput.value) {
    (e.shiftKey ? search.findPrevious : search.findNext).call(search, findInput.value, FIND_OPTS);
  } else return;
  e.preventDefault();
});

function flash(msg, ms = 1500) {
  statusBar.textContent = msg;
  statusBar.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { statusBar.hidden = true; }, ms);
}

function refit() {
  fit.fit();
  pty.resize(term.cols, term.rows);
}
window.addEventListener('resize', refit);

// Theme: xterm colors plus CSS variables for everything we draw ourselves (math overlays, status bar).
function applyTheme(theme) {
  const t = { ...THEMES.default, ...theme }; // a partial custom theme falls back to the defaults
  term.options.theme = t;
  const css = document.documentElement.style;
  for (const [k, v] of Object.entries({ bg: t.background, fg: t.foreground, dim: t.brightBlack,
    'status-bg': t.black })) css.setProperty(`--${k}`, v);
  if (typeof queueScan === 'function') queueScan(); // auto-detect overlays copy cell colors (automath.js)
}

// Zoom (Cmd +/-/0). Auto-detect overlays rebuild on their own: cell size is part of their key.
let baseFontSize = 14;
function setFontSize(px) {
  term.options.fontSize = Math.max(6, Math.min(48, px));
  document.documentElement.style.setProperty('--font-size', `${term.options.fontSize}px`);
  refit();
}

// ~/.config/mathterm/config.json: { "theme": "catppuccin-mocha" | {..ITheme..}, "fontSize": 14, "fontFamily": "...",
//   "lineHeight": 1.2, "autoDetectIgnore": ["*.tex", ...], "renderer": "webgl" | "dom" }
let config = {}; // the parsed config.json, for other modules (automath.js reads autoDetectIgnore)
function applyConfig(text) {
  let cfg = {};
  try {
    cfg = JSON.parse(text || '{}');
  } catch (e) {
    flash(`config.json: ${e.message}`, 5000);
  }
  config = cfg;
  if (typeof cfg.theme === 'string' && !THEMES[cfg.theme]) {
    flash(`config.json: unknown theme "${cfg.theme}" (built-in: ${Object.keys(THEMES).join(', ')})`, 5000);
  }
  applyTheme(typeof cfg.theme === 'string' ? THEMES[cfg.theme] : cfg.theme);
  if (cfg.renderer !== 'dom') useWebgl();
  if (cfg.fontFamily) term.options.fontFamily = cfg.fontFamily;
  if (cfg.lineHeight) term.options.lineHeight = cfg.lineHeight;
  baseFontSize = cfg.fontSize || baseFontSize;
  setFontSize(baseFontSize);
}

// One key handler for the whole app (xterm allows only one). Return true from a binding to consume the key.
const keyBindings = [
  (e) => e.metaKey && (e.key === '=' || e.key === '+') && (setFontSize(term.options.fontSize + 1), true),
  (e) => e.metaKey && e.key === '-' && (setFontSize(term.options.fontSize - 1), true),
  (e) => e.metaKey && !e.shiftKey && e.key === 'n' && (invoke('new_window'), true),
  (e) => e.metaKey && !e.shiftKey && !e.ctrlKey && e.key === 'f' && (openFind(), true), // Ctrl-Cmd-F: full screen
  (e) => e.metaKey && e.key === '0' && (setFontSize(baseFontSize), true),
  (e) => devMode && e.metaKey && e.shiftKey && e.key.toLowerCase() === 'd' && (saveCapture(), true),
];

// Debug capture (Cmd-Shift-D, dev builds only: `npm start`): every chunk of pty output since the window opened, with the size it arrived at,
// plus what the screen holds now, saved as JSON lines to ~/mathterm-debug-<time>.jsonl. Replaying it into
// @xterm/headless shows whether a wrong screen comes from the bytes (emulation) or from drawing.
// ponytail: recording stops at CAPTURE_MAX; open a new window to capture a long session's later part.
const CAPTURE_MAX = 32e6;
let devMode = false; // set from Rust's `dev` before the shell starts; release builds record nothing
const capture = [];
let captureLen = 0;
function record(d) {
  if (!devMode || captureLen > CAPTURE_MAX) return;
  captureLen += d.length;
  capture.push(JSON.stringify({ d, cols: term.cols, rows: term.rows }));
}
async function saveCapture() {
  const b = term.buffer.active;
  const screen = Array.from({ length: term.rows }, (_, y) => b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
  const head = JSON.stringify({ cols: term.cols, rows: term.rows, alt: b.type === 'alternate', truncated: captureLen > CAPTURE_MAX, screen });
  try {
    flash(`saved ${await invoke('save_debug', { text: [head, ...capture].join('\n') })}`, 4000);
  } catch (e) {
    flash(`debug capture: ${e}`, 4000);
  }
}
term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && keyBindings.some((k) => k(e))));

term.onData(pty.write);
// Load the config (theme, font size) and attach the listener before starting the shell, so the shell starts
// at the final size and the first prompt isn't lost.
Promise.all([
  invoke('dev').then((d) => { devMode = d; }, () => {}),
  invoke('config').then(applyConfig, () => applyConfig('')),
  // this window's shell only (a global `listen` would also get other windows' output)
  window.__TAURI__.webviewWindow.getCurrentWebviewWindow().listen('pty', (e) => { record(e.payload); term.write(e.payload); }),
]).then(() => invoke('start', { cols: term.cols, rows: term.rows }));

// KaTeX's @font-face fonts load lazily on first use, so the first measurements would use fallback glyphs
// (WebKit here never fires `loadingdone` either). Load them all up front; measuring code waits on this.
const katexFonts = Promise.allSettled([...document.fonts].filter((f) => f.family.includes('KaTeX')).map((f) => f.load()));

function cellSize() {
  const screen = term.element.querySelector('.xterm-screen');
  return [screen.clientWidth / term.cols, screen.clientHeight / term.rows];
}

// Inline math is fitted to this many rows of *ink* height (see inkBox). 1.0 keeps it off neighboring rows.
const INLINE_OVERFLOW = 1.0;

// Vertical ink extent of rendered KaTeX, and how far its center sits from the element's box center.
// KaTeX's struts span exactly the content's height + depth. The line box (line-height 1.2) is taller than
// a terminal row even for a plain `x`, so fitting by the box made everything look "slightly tall".
function inkBox(el) {
  const box = el.getBoundingClientRect();
  let top = Infinity, bottom = -Infinity;
  for (const st of el.querySelectorAll('.katex-html .strut')) {
    const r = st.getBoundingClientRect();
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  if (top === Infinity) return { height: box.height, offset: 0 };
  return { height: bottom - top, offset: (top + bottom - box.top - box.bottom) / 2 };
}

// Scale `inner` (left/top-50% positioned) to fit w x h by its ink, with the ink centered vertically.
function fitInk(inner, w, h) {
  const r = inner.getBoundingClientRect(), ink = inkBox(inner);
  const s = Math.min(1, w / r.width, h / ink.height);
  inner.style.transform = `translateY(-50%) translateY(${-ink.offset * s}px) scale(${s})`;
}

initOsc52(term, (text) => invoke('copy', { text }).catch((e) => flash(`clipboard: ${e}`, 4000)));
