const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const pty = {
  write: (data) => invoke('write', { data }),
  resize: (cols, rows) => invoke('resize', { cols, rows }),
};

const term = new Terminal({
  allowProposedApi: true, // needed for registerDecoration
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

// Theme: xterm colors plus CSS variables for everything we draw ourselves (math overlays, rules, status bar).
function applyTheme(theme) {
  const t = { ...THEMES.default, ...theme }; // a partial custom theme falls back to the defaults
  term.options.theme = t;
  const css = document.documentElement.style;
  for (const [k, v] of Object.entries({ bg: t.background, fg: t.foreground, dim: t.brightBlack,
    h1: t.magenta, 'status-bg': t.black })) css.setProperty(`--${k}`, v);
  if (typeof queueScan === 'function') queueScan(); // auto-detect overlays copy cell colors (automath.js)
}

// Zoom (Cmd +/-/0). Math overlays are laid out in cells, so they're re-placed at the new size.
let baseFontSize = 14;
function setFontSize(px) {
  term.options.fontSize = Math.max(6, Math.min(48, px));
  document.documentElement.style.setProperty('--font-size', `${term.options.fontSize}px`);
  refit();
  relayout();
}

// ~/.config/mathterm/config.json: { "theme": "catppuccin-mocha" | {..ITheme..}, "fontSize": 14, "fontFamily": "...",
//   "autoDetectIgnore": ["*.tex", ...] }
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
  if (cfg.fontFamily) term.options.fontFamily = cfg.fontFamily;
  baseFontSize = cfg.fontSize || baseFontSize;
  setFontSize(baseFontSize);
}

// One key handler for the whole app (xterm allows only one). Return true from a binding to consume the key.
const keyBindings = [
  (e) => e.metaKey && (e.key === '=' || e.key === '+') && (setFontSize(term.options.fontSize + 1), true),
  (e) => e.metaKey && e.key === '-' && (setFontSize(term.options.fontSize - 1), true),
  (e) => e.metaKey && e.key === '0' && (setFontSize(baseFontSize), true),
];
term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && keyBindings.some((k) => k(e))));

term.onData(pty.write);
// Load the config (theme, font size) and attach the listener before starting the shell, so the shell starts
// at the final size and the first prompt isn't lost.
Promise.all([
  invoke('config').then(applyConfig, () => applyConfig('')),
  listen('pty', (e) => term.write(e.payload)),
]).then(() => invoke('start', { cols: term.cols, rows: term.rows }));

// Hidden element used to measure rendered KaTeX in pixels.
const probe = document.createElement('div');
probe.className = 'math-probe';
document.body.appendChild(probe);

// KaTeX's @font-face fonts load lazily on first use, so the first measurements would use fallback glyphs
// (WebKit here never fires `loadingdone` either). Load them all up front; measuring code waits on this.
const katexFonts = Promise.allSettled([...document.fonts].filter((f) => f.family.includes('KaTeX')).map((f) => f.load()));

function cellSize() {
  const screen = term.element.querySelector('.xterm-screen');
  return [screen.clientWidth / term.cols, screen.clientHeight / term.rows];
}

// Inline math is fitted to this many rows of *ink* height (see inkBox). 1.0 keeps it off neighboring rows.
const INLINE_OVERFLOW = 1.0;
// Below this scale, inline math is reported as 3 rows tall: the sender adds a blank line above and below.
const TALL_SCALE = 0.85;

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

// Size of `tex` in cells. Inline width is taken after scaling its ink to fit its rows.
function measure(tex, display) {
  katex.render(tex, probe, { displayMode: display, throwOnError: false });
  const { width, height } = probe.getBoundingClientRect();
  const [cw, ch] = cellSize();
  if (display) return [Math.ceil(width / cw), Math.ceil(height / ch)];
  const ink = inkBox(probe).height;
  const s1 = Math.min(1, (INLINE_OVERFLOW * ch) / ink);
  if (s1 >= TALL_SCALE) return [Math.ceil((width * s1) / cw), 1];
  return [Math.ceil((width * Math.min(1, (3 * ch) / ink)) / cw), 3];
}

// Everything drawn (math and rules), so it can be re-placed when the terminal is resized and lines re-wrap.
// `marker` sits on the first row of the logical (unwrapped) line; `offset` is the column within that line.
const items = [];

// True if row `line` has no text in columns [x, x + width): tall inline math may spill into it.
function rowFree(line, x, width) {
  const row = term.buffer.active.getLine(line);
  return !row || row.translateToString(true, x, x + width).trim() === '';
}

function place(item) {
  item.deco?.dispose();
  item.rowMarker?.dispose();
  item.rowMarker = null;
  const b = term.buffer.active, C = term.cols;
  let line = item.marker.line, x, width = Math.min(item.cols, C);
  if (item.rule) {
    x = 0; width = C; // rules always span the current width
  } else if (item.display) {
    x = Math.floor((C - width) / 2); // display math is centered by the terminal
  } else {
    line += Math.floor(item.offset / C);
    x = item.offset % C;
    width = Math.min(width, C - x); // straddling the right edge: shrink rather than spill
  }
  // Tall inline math only uses the rows above/below while they're empty under it. After a narrowing
  // resize they may hold wrapped text, and it falls back to fitting its own row.
  const room = item.rows > 1 && !item.display && !(rowFree(line - 1, x, width) && rowFree(line + 1, x, width))
    ? 1 : item.rows;
  let marker = item.marker;
  if (line !== marker.line) marker = item.rowMarker = term.registerMarker(line - (b.baseY + b.cursorY));
  item.deco = term.registerDecoration({ marker, x, width, height: item.display ? item.rows : 1, layer: 'top' });
  item.deco?.onRender((el) => {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    if (item.rule) {
      el.classList.add('rule', `rule-${item.rule}`);
      return;
    }
    el.classList.add('math', item.display ? 'display' : 'inline');
    const inner = document.createElement('div');
    katex.render(item.tex, inner, { displayMode: item.display, throwOnError: false });
    el.appendChild(inner);
    // getBoundingClientRect, like measure(): scrollWidth/Height also count KaTeX's hidden MathML copy,
    // which WebKit lays out taller for fractions and made them shrink for no reason
    const r = inner.getBoundingClientRect();
    if (item.display) {
      const s = Math.min(1, el.clientWidth / r.width, el.clientHeight / r.height);
      inner.style.transform = `translate(-50%, -50%) scale(${s})`;
    } else {
      fitInk(inner, el.clientWidth, el.clientHeight * Math.max(INLINE_OVERFLOW, room));
    }
  });
}

// Anchor at the cursor: a marker on the first row of its logical line + the column within that line.
function anchor() {
  const b = term.buffer.active;
  const y = b.baseY + b.cursorY;
  let start = y;
  while (start > 0 && b.getLine(start)?.isWrapped) start--;
  return { marker: term.registerMarker(start - y), offset: (y - start) * term.cols + b.cursorX };
}

// Scale `inner` (left/top-50% positioned) to fit w x h by its ink, with the ink centered vertically.
function fitInk(inner, w, h) {
  const r = inner.getBoundingClientRect(), ink = inkBox(inner);
  const s = Math.min(1, w / r.width, h / ink.height);
  inner.style.transform = `translateY(-50%) translateY(${-ink.offset * s}px) scale(${s})`;
}

function draw(fields) {
  const item = { ...fields, ...anchor() };
  if (!item.marker) return;
  items.push(item);
  place(item);
}

// Literal-text spans (OSC 7777;raw;<len>): auto-detect (automath.js) never typesets these cells.
// `mdv` marks code with them, since styled code has no backticks left to recognize it by.
const rawSpans = [];

// ponytail: re-renders every item's KaTeX on each resize; cache the rendered HTML if long scrollback gets slow
function relayout() {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].marker.isDisposed) items.splice(i, 1); // scrolled out of the scrollback
    else place(items[i]);
  }
}
term.onResize(relayout);

// Protocol (see NOTES.md):
//   query:  OSC 7777 ; ? ; <i|d> ; <latex> BEL      -> reply OSC 7777 ; = ; <cols> ; <rows> BEL
//   draw:   OSC 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL   (inline rows > 1 = tall, see TALL_SCALE)
//   rule:   OSC 7777 ; rule ; <h1|hr> BEL                     (full-width line on the current row)
//   raw:    OSC 7777 ; raw ; <len> BEL                        (next len cells are literal: no auto-detect)
term.parser.registerOscHandler(7777, (payload) => {
  let m = /^\?;([id]);([\s\S]*)$/.exec(payload);
  if (m) {
    const [cols, rows] = measure(m[2], m[1] === 'd');
    pty.write(`\x1b]7777;=;${cols};${rows}\x07`);
    return true;
  }
  m = /^(\d+);(\d+);([id]);([\s\S]*)$/.exec(payload);
  if (m) {
    draw({ tex: m[4], display: m[3] === 'd', cols: +m[1], rows: +m[2] });
    return true;
  }
  m = /^raw;(\d+)$/.exec(payload);
  if (m) {
    const a = anchor();
    if (a.marker) rawSpans.push({ ...a, len: +m[1] });
    return true;
  }
  m = /^rule;(h1|hr)$/.exec(payload);
  if (m) {
    draw({ rule: m[1], cols: 0, rows: 1 });
    return true;
  }
  return false;
});
