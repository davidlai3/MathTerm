const term = new Terminal({
  allowProposedApi: true, // needed for registerDecoration
  fontFamily: 'Menlo, monospace',
  fontSize: 14,
  theme: { background: '#1e1e1e' },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('term'));

function resize() {
  fit.fit();
  pty.resize(term.cols, term.rows);
}
resize();
window.addEventListener('resize', resize);

term.onData(pty.write);
pty.onData((d) => term.write(d));

// OSC 7777 ; <cols> ; <rows> ; <latex> BEL
// The sender pads a cols x rows box (spaces / newlines) right after the sequence;
// we overlay KaTeX on that box, shrinking it to fit.
term.parser.registerOscHandler(7777, (payload) => {
  const m = /^(\d+);(\d+);([\s\S]*)$/.exec(payload);
  if (!m) return false;
  const cols = +m[1], rows = +m[2], tex = m[3];

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
    el.classList.add('math');
    if (rows > 1) el.classList.add('display');
    const inner = document.createElement('div');
    katex.render(tex, inner, { displayMode: rows > 1, throwOnError: false });
    el.appendChild(inner);
    const s = Math.min(1, el.clientWidth / inner.scrollWidth, el.clientHeight / inner.scrollHeight);
    inner.style.transform = `scale(${s})`;
  });
  return true;
});
