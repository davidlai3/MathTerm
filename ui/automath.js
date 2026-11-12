// Auto-detect mode: find LaTeX in whatever is on screen ($..$, $$..$$, \(..\), \[..\]) and typeset it over
// the source's own cells. Works for programs that never send OSC 7777: Claude Code, cat, nvim while editing.
// Overlays are screen-positioned and rebuilt from the viewport after every render, diffed by key, so
// unchanged math is left alone. The cursor row (or a block containing it) keeps showing the source.
// Toggle: Cmd-Shift-M. Uses `term`, `statusBar`, `cellSize`, `INLINE_OVERFLOW`, `rawSpans` from renderer.js.

let autoMath = true;
const autoLayer = document.createElement('div');
autoLayer.className = 'auto-layer';
term.element.querySelector('.xterm-screen').appendChild(autoLayer);
const autoEls = new Map(); // key -> element currently shown
const htmlCache = new Map(); // `${display}|${tex}` -> KaTeX HTML, or null if it doesn't parse

// Same rules as mdv: no space just inside $, closing $ not followed by a digit (so "$5 and $10" is text).
// No `│` inside a match, so math can't span an editor's vertical split.
const INLINE_RX = /\$\$([^$│]+?)\$\$|(?<![\\$])\$(?=[^\s$])([^$│]+?)(?<=\S)\$(?!\$|\d)|\\\((.+?)\\\)|\\\[(.+?)\\\]/g;
// A row holding only a block delimiter, optionally after an editor's line number: "  12 $$"
const BLOCK_OPEN = /^(\s*(?:\d+\s+)?)(\$\$|\\\[)\s*$/;
const MAX_BLOCK_ROWS = 30;
// Math may grow into this many empty rows above and below its source (programs like Claude Code put a
// one-line $$..$$ between blank lines). Display math uses all of it; inline math grows symmetrically so it
// stays centered on its text row.
const MAX_GROW = 3;
// Markdown code: skip rows inside ``` fences (tracked from the top of the viewport) and `inline code`.
const FENCE = /^\s*(?:\d+\s+)?```/;

// xterm.js's default palette (Tango) and the 256-color cube, to give math its source's colors.
const ANSI16 = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
function palette(i) {
  if (i < 16) return ANSI16[i];
  if (i < 232) {
    const v = [0, 95, 135, 175, 215, 255];
    i -= 16;
    return `rgb(${v[Math.floor(i / 36)]},${v[Math.floor(i / 6) % 6]},${v[i % 6]})`;
  }
  const g = 8 + (i - 232) * 10;
  return `rgb(${g},${g},${g})`;
}
function cellColor(cell, wantFg) {
  const fg = wantFg !== !!cell.isInverse(); // inverse video swaps the two
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return fg ? '#ffffff' : term.options.theme.background;
  const v = fg ? cell.getFgColor() : cell.getBgColor();
  return (fg ? cell.isFgRGB() : cell.isBgRGB()) ? `#${v.toString(16).padStart(6, '0')}` : palette(v);
}

// A row as a string, plus the cell column where each UTF-16 unit starts and the width of its cell.
function rowCells(line) {
  let text = '';
  const col = [], wid = [];
  for (let x = 0; x < term.cols; x++) {
    const c = line.getCell(x);
    if (!c) break;
    if (c.getWidth() === 0) continue; // right half of a wide character
    const s = c.getChars() || ' ';
    for (let k = 0; k < s.length; k++) { col.push(x); wid.push(c.getWidth()); }
    text += s;
  }
  return { text, col, wid };
}

function katexHtml(tex, display) {
  const key = `${display}|${tex}`;
  if (!htmlCache.has(key)) {
    try {
      htmlCache.set(key, katex.renderToString(tex, { displayMode: display, throwOnError: true }));
    } catch {
      htmlCache.set(key, null); // not valid LaTeX: leave the text alone
    }
  }
  return htmlCache.get(key);
}

function findMath() {
  const b = term.buffer.active;
  const cursorRow = b.baseY + b.cursorY - b.viewportY; // viewport-relative
  const rows = [];
  for (let y = 0; y < term.rows; y++) {
    const line = b.getLine(b.viewportY + y);
    rows.push(line ? rowCells(line) : { text: '', col: [], wid: [] });
  }
  const found = [];
  const cell = (y, i) => b.getLine(b.viewportY + y)?.getCell(rows[y].col[i]);

  // Literal spans (OSC 7777;raw) by viewport row: [[x0, x1], ...]. A span can wrap onto following rows.
  const raw = new Map();
  for (let i = rawSpans.length - 1; i >= 0; i--) {
    const sp = rawSpans[i];
    if (sp.marker.isDisposed) { rawSpans.splice(i, 1); continue; }
    for (let off = sp.offset, left = sp.len; left > 0;) {
      const y = sp.marker.line + Math.floor(off / term.cols) - b.viewportY, x = off % term.cols;
      const n = Math.min(left, term.cols - x);
      if (y >= 0 && y < term.rows) raw.set(y, [...(raw.get(y) || []), [x, x + n]]);
      off += n; left -= n;
    }
  }
  const isRaw = (y, x0, x1) => (raw.get(y) || []).some(([a, z]) => x0 < z && a < x1);
  let inFence = false;
  for (let y = 0; y < rows.length; y++) {
    const { text, col, wid } = rows[y];
    if (FENCE.test(text)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const open = BLOCK_OPEN.exec(text);
    if (open) { // multi-row $$ ... $$ or \[ ... \]
      const close = open[2] === '$$' ? '$$' : '\\]';
      const start = open[1].length;
      let end = -1;
      for (let k = y + 1; k < Math.min(rows.length, y + MAX_BLOCK_ROWS); k++) {
        if (rows[k].text.slice(start).trim() === close) { end = k; break; }
      }
      if (end > 0) {
        if (cursorRow < y || cursorRow > end) {
          const body = rows.slice(y + 1, end).map((r) => r.text.slice(start)).join(' ');
          const x1 = Math.max(...rows.slice(y, end + 1).map((r) => {
            const n = r.text.trimEnd().length;
            return n ? r.col[n - 1] + r.wid[n - 1] : 0;
          }));
          const c = cell(y + 1, start) || cell(y, start);
          found.push({ y, rows: end - y + 1, x0: col[start], x1, tex: body.trim(), display: true, c });
        }
        y = end;
        continue;
      }
    }
    // The logical line: this row plus any soft-wrapped continuation rows (long $$..$$ lines wrap).
    let yEnd = y;
    while (yEnd + 1 < rows.length && b.getLine(b.viewportY + yEnd + 1)?.isWrapped) yEnd++;
    let gText = '';
    const gCol = [], gWid = [], gRow = [];
    for (let k = y; k <= yEnd; k++) {
      gText += rows[k].text;
      for (let i = 0; i < rows[k].col.length; i++) { gCol.push(rows[k].col[i]); gWid.push(rows[k].wid[i]); gRow.push(k); }
    }
    for (const m of gText.matchAll(INLINE_RX)) {
      const tex = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
      const display = m[1] !== undefined || m[4] !== undefined;
      const i0 = m.index, i1 = m.index + m[0].length;
      const r0 = gRow[i0], r1 = gRow[i1 - 1];
      if (cursorRow >= r0 && cursorRow <= r1) continue; // editing this line: show the source
      if ((gText.slice(0, i0).match(/`/g) || []).length % 2) continue; // inside `inline code`
      const c = b.getLine(b.viewportY + gRow[i0 + (display ? 2 : 1)])?.getCell(gCol[i0 + (display ? 2 : 1)]);
      if (r0 === r1) {
        const x0 = gCol[i0], x1 = gCol[i1 - 1] + gWid[i1 - 1];
        if (!isRaw(r0, x0, x1)) found.push({ y: r0, rows: 1, x0, x1, tex, display, c });
      } else if (!gText.slice(0, i0).trim() && !gText.slice(i1).trim()) {
        // wrapped across rows: only when nothing else shares those rows, so covering them full-width is safe
        found.push({ y: r0, rows: r1 - r0 + 1, x0: 0, x1: term.cols, pad: gCol[i0], wrapped: true, tex, display, c });
      }
    }
    y = yEnd;
  }
  grow(found, cursorRow);
  return found;
}

// Give each match `top`/`span`: its rows plus empty rows around it (no text under it, not the cursor row,
// not another match). When two matches share a gap, the upper one gets floor(gap/2) and the lower one
// gets the rest, so they never overlap.
function grow(found, cursorRow) {
  const b = term.buffer.active;
  const taken = new Set();
  for (const f of found) for (let k = 0; k < f.rows; k++) taken.add(f.y + k);
  const free = (y, x0, x1) => y >= 0 && y < term.rows && y !== cursorRow && !taken.has(y) &&
    (b.getLine(b.viewportY + y)?.translateToString(true, x0, x1) ?? '').trim() === '';
  for (const f of found) {
    const last = f.y + f.rows - 1;
    let up = 0, down = 0;
    while (up < 2 * MAX_GROW && free(f.y - 1 - up, f.x0, f.x1)) up++;
    while (down < 2 * MAX_GROW && free(last + 1 + down, f.x0, f.x1)) down++;
    up = Math.min(MAX_GROW, taken.has(f.y - 1 - up) ? Math.ceil(up / 2) : up);
    down = Math.min(MAX_GROW, taken.has(last + 1 + down) ? Math.floor(down / 2) : down);
    if (!f.display) up = down = Math.min(up, down);
    f.top = f.y - up;
    f.span = f.rows + up + down;
  }
}

function makeOverlay(item, cw, ch) {
  const html = katexHtml(item.tex, item.display);
  if (!html) return null;
  const el = document.createElement('div');
  const block = item.display && item.rows > 1 && !item.wrapped; // multi-row $$ block: centered both ways
  el.className = `auto-math${block ? ' block' : ''}`;
  Object.assign(el.style, {
    left: `${item.x0 * cw}px`, top: `${item.top * ch}px`,
    width: `${(item.x1 - item.x0) * cw}px`, height: `${item.span * ch}px`,
    color: item.c ? cellColor(item.c, true) : '#ffffff',
    background: item.c ? cellColor(item.c, false) : term.options.theme.background,
  });
  const inner = document.createElement('div');
  inner.innerHTML = html;
  const pad = (item.pad || 0) * cw; // wrapped lines: keep the source's indent
  if (pad) inner.style.left = `${pad}px`;
  el.appendChild(inner);
  autoLayer.appendChild(el);
  const r = inner.getBoundingClientRect();
  const maxH = item.span * ch * (item.span === 1 ? INLINE_OVERFLOW : 1);
  const s = Math.min(1, ((item.x1 - item.x0) * cw - pad) / r.width, maxH / r.height);
  inner.style.transform = `${block ? 'translate(-50%, -50%)' : 'translateY(-50%)'} scale(${s})`;
  return el;
}

let scanQueued = false;
function scan() {
  scanQueued = false;
  const want = new Map();
  if (autoMath) {
    const [cw, ch] = cellSize();
    for (const it of findMath()) {
      const key = [it.top, it.span, it.y, it.rows, it.x0, it.x1, it.display, it.tex, it.c && cellColor(it.c, true),
        it.c && cellColor(it.c, false), cw, ch].join('|');
      want.set(key, it);
    }
    for (const [key, el] of autoEls) if (!want.has(key)) { el.remove(); autoEls.delete(key); }
    for (const [key, it] of want) {
      if (autoEls.has(key)) continue;
      const el = makeOverlay(it, cw, ch);
      if (el) autoEls.set(key, el);
    }
  } else {
    for (const el of autoEls.values()) el.remove();
    autoEls.clear();
  }
}
function queueScan() {
  if (!scanQueued) { scanQueued = true; requestAnimationFrame(scan); }
}

term.onRender(queueScan);
term.onScroll(queueScan);
term.onResize(queueScan);
term.onCursorMove(queueScan);

term.attachCustomKeyEventHandler((e) => {
  if (e.type === 'keydown' && e.metaKey && e.shiftKey && e.key.toLowerCase() === 'm') {
    autoMath = !autoMath;
    statusBar.textContent = `auto math: ${autoMath ? 'on' : 'off'}  ·  ⌘⇧M`;
    statusBar.hidden = false;
    setTimeout(() => { statusBar.hidden = true; }, 1200);
    queueScan();
    return false;
  }
  return true;
});
