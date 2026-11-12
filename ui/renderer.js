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
  theme: { background: '#1e1e1e' },
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

fit.fit();
window.addEventListener('resize', () => {
  fit.fit();
  pty.resize(term.cols, term.rows);
});
term.onData(pty.write);
// attach the listener before starting the shell so the first prompt isn't lost
listen('pty', (e) => term.write(e.payload)).then(() =>
  invoke('start', { cols: term.cols, rows: term.rows }));

// Hidden element used to measure rendered KaTeX in pixels.
const probe = document.createElement('div');
probe.className = 'math-probe';
document.body.appendChild(probe);

function cellSize() {
  const screen = term.element.querySelector('.xterm-screen');
  return [screen.clientWidth / term.cols, screen.clientHeight / term.rows];
}

// Inline math may spill this far past its row (split above/below) before being shrunk.
const INLINE_OVERFLOW = 1.25;
// Below this scale, inline math is reported as 3 rows tall: the sender adds a blank line above and below.
const TALL_SCALE = 0.85;

// Size of `tex` in cells. Inline width is taken after scaling to fit its rows.
function measure(tex, display) {
  katex.render(tex, probe, { displayMode: display, throwOnError: false });
  const { width, height } = probe.getBoundingClientRect();
  const [cw, ch] = cellSize();
  if (display) return [Math.ceil(width / cw), Math.ceil(height / ch)];
  const s1 = Math.min(1, (INLINE_OVERFLOW * ch) / height);
  if (s1 >= TALL_SCALE) return [Math.ceil((width * s1) / cw), 1];
  return [Math.ceil((width * Math.min(1, (3 * ch) / height)) / cw), 3];
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
    const maxH = el.clientHeight * (item.display ? 1 : Math.max(INLINE_OVERFLOW, room));
    // getBoundingClientRect, like measure(): scrollWidth/Height also count KaTeX's hidden MathML copy,
    // which WebKit lays out taller for fractions and made them shrink for no reason
    const r = inner.getBoundingClientRect();
    const s = Math.min(1, el.clientWidth / r.width, maxH / r.height);
    inner.style.transform = `${item.display ? 'translate(-50%, -50%)' : 'translateY(-50%)'} scale(${s})`;
  });
}

function draw(fields) {
  const b = term.buffer.active;
  const y = b.baseY + b.cursorY;
  let start = y;
  while (start > 0 && b.getLine(start)?.isWrapped) start--;
  const item = {
    ...fields,
    marker: term.registerMarker(start - y),
    offset: (y - start) * term.cols + b.cursorX,
  };
  if (!item.marker) return;
  items.push(item);
  place(item);
}

// ponytail: re-renders every item's KaTeX on each resize; cache the rendered HTML if long scrollback gets slow
term.onResize(() => {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].marker.isDisposed) items.splice(i, 1); // scrolled out of the scrollback
    else place(items[i]);
  }
});

// Protocol (see NOTES.md):
//   query:  OSC 7777 ; ? ; <i|d> ; <latex> BEL      -> reply OSC 7777 ; = ; <cols> ; <rows> BEL
//   draw:   OSC 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL   (inline rows > 1 = tall, see TALL_SCALE)
//   rule:   OSC 7777 ; rule ; <h1|hr> BEL                     (full-width line on the current row)
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
  m = /^rule;(h1|hr)$/.exec(payload);
  if (m) {
    draw({ rule: m[1], cols: 0, rows: 1 });
    return true;
  }
  return false;
});
