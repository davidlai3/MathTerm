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
});
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

// Size of `tex` in cells. Inline math is squeezed into one row, so its width is taken after scaling.
function measure(tex, display) {
  katex.render(tex, probe, { displayMode: display, throwOnError: false });
  const { width, height } = probe.getBoundingClientRect();
  const [cw, ch] = cellSize();
  if (display) return [Math.ceil(width / cw), Math.ceil(height / ch)];
  return [Math.ceil((width * Math.min(1, (INLINE_OVERFLOW * ch) / height)) / cw), 1];
}

function draw(tex, display, cols, rows) {
  const deco = term.registerDecoration({
    marker: term.registerMarker(0),
    x: term.buffer.active.cursorX,
    width: cols,
    height: rows,
    layer: 'top',
  });
  deco?.onRender((el) => {
    if (el.dataset.tex) return;
    el.dataset.tex = '1';
    el.classList.add('math', display ? 'display' : 'inline');
    const inner = document.createElement('div');
    katex.render(tex, inner, { displayMode: display, throwOnError: false });
    el.appendChild(inner);
    const maxH = el.clientHeight * (display ? 1 : INLINE_OVERFLOW);
    const s = Math.min(1, el.clientWidth / inner.scrollWidth, maxH / inner.scrollHeight);
    inner.style.transform = `scale(${s})`;
  });
}

// Protocol (see NOTES.md):
//   query:  OSC 7777 ; ? ; <i|d> ; <latex> BEL      -> reply OSC 7777 ; = ; <cols> ; <rows> BEL
//   draw:   OSC 7777 ; <cols> ; <rows> ; <i|d> ; <latex> BEL
term.parser.registerOscHandler(7777, (payload) => {
  let m = /^\?;([id]);([\s\S]*)$/.exec(payload);
  if (m) {
    const [cols, rows] = measure(m[2], m[1] === 'd');
    pty.write(`\x1b]7777;=;${cols};${rows}\x07`);
    return true;
  }
  m = /^(\d+);(\d+);([id]);([\s\S]*)$/.exec(payload);
  if (m) {
    draw(m[4], m[3] === 'd', +m[1], +m[2]);
    return true;
  }
  return false;
});
