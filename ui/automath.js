// Auto-detect mode: find LaTeX in whatever is on screen ($..$, $$..$$, \(..\), \[..\]) and typeset it over
// the source's own cells. Works for programs that never send OSC 7777: Claude Code, cat, nvim while editing.
// Overlays are screen-positioned and rebuilt from the viewport after every render, diffed by key, so
// unchanged math is left alone. The cursor row (or a block containing it) keeps showing the source.
// Toggle: Cmd-Shift-M. Ignore list: `autoDetectIgnore` in config.json.
// Uses `term`, `invoke`, `config`, `flash`, `keyBindings`, `cellSize`, `INLINE_OVERFLOW`, `rawSpans`, `fitInk` from renderer.js
// and `ANSI_KEYS` from themes.js.

let autoMath = true;
const autoLayer = document.createElement('div');
autoLayer.className = 'auto-layer';
term.element.querySelector('.xterm-screen').appendChild(autoLayer);
let autoEls = new Map(); // key (everything but position) -> [{ el, top, x0 }] currently shown
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
// When math grew into neighboring rows, keep this much (in rows) clear at the top and bottom so it
// doesn't touch the text around it.
const GROW_MARGIN = 0.25;
// One-row inline math may overflow its row by this much when neither neighbor row has math: KaTeX's
// parentheses are taller than a text row, so at 1.0 `f(x)` shrinks to ~0.86. Text rows have spare padding
// (lineHeight 1.2); a neighbor's math would collide, so with one it stays at INLINE_OVERFLOW.
const LONE_OVERFLOW = 1.1;
// Markdown code: skip rows inside ``` fences (tracked from the top of the viewport) and `inline code`.
const FENCE = /^\s*(?:\d+\s+)?```/;
// GFM tables, same rules as mdv: a row with `|`, then a separator row, then rows while they contain `|`.
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
// Rows above the viewport read to know whether its top is inside a fence.
// ponytail: fixed lookback, a fence opened further up is missed; track fence state per line if that bites.
const FENCE_LOOKBACK = 200;

// TUIs (Claude Code) hide the cursor and move it around while redrawing; only a visible cursor marks the
// row being edited. DECTCEM is tracked here because xterm doesn't expose it; returning false keeps xterm's
// own handling.
let cursorVisible = true;
for (const [final, vis] of [['h', true], ['l', false]]) {
  term.parser.registerCsiHandler({ prefix: '?', final }, (params) => {
    if (params.includes(25)) { cursorVisible = vis; queueScan(); }
    return false;
  });
}

// The theme's 16 colors and the 256-color cube, to give math its source's colors.
function palette(i) {
  if (i < 16) return term.options.theme[ANSI_KEYS[i]];
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
  if (fg ? cell.isFgDefault() : cell.isBgDefault()) return term.options.theme[fg ? 'foreground' : 'background'];
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

// Claude Code's markdown unescapes `\!` to `!`, so `\sin\!\left(` arrives as `\sin!\left(`. A `!` right
// after a command name (or big-O: `O\!\left(`) is never a factorial in practice, so put the backslash back.
// The other stripped escapes (`\,` `\{` `\\`) can't be told apart from real text.
const unstrip = (tex) => tex.replace(/(\\[a-zA-Z]+|\bO)!/g, '$1\\!');

function findMath() {
  const b = term.buffer.active;
  const cursorRow = cursorVisible ? b.baseY + b.cursorY - b.viewportY : -1; // viewport-relative
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
  let fence0 = false;
  for (let y = Math.max(0, b.viewportY - FENCE_LOOKBACK); y < b.viewportY; y++) {
    if (FENCE.test(b.getLine(y)?.translateToString(true) ?? '')) fence0 = !fence0;
  }
  const blockBody = (y, end, start) => rows.slice(y + 1, end).map((r) => r.text.slice(start)).join(' ').trim();
  // Multi-row $$ ... $$ / \[ ... \] blocks as openRow -> { end, start }. `$$` opens and closes alike, so when
  // a block's opening row has scrolled off (always possible on the alt screen), its closing `$$` at the top
  // would pair with the next block's opener and shift every pair below by one. So pair both ways (first
  // `$$` as an opener, or as a stray closer) and keep the pairing whose bodies parse as LaTeX.
  function pairBlocks(skipFirst) {
    const blocks = new Map();
    let inFence = fence0, score = 0, first = true;
    for (let y = 0; y < rows.length; y++) {
      const text = rows[y].text;
      if (FENCE.test(text)) { inFence = !inFence; continue; }
      const open = !inFence && BLOCK_OPEN.exec(text);
      if (!open) continue;
      const stray = first && skipFirst && open[2] === '$$';
      first = false;
      if (stray) { blocks.set(y, null); continue; }
      const close = open[2] === '$$' ? '$$' : '\\]';
      const start = open[1].length;
      for (let k = y + 1; k < Math.min(rows.length, y + MAX_BLOCK_ROWS); k++) {
        if (rows[k].text.slice(start).trim() !== close) continue;
        blocks.set(y, { end: k, start });
        score += katexHtml(unstrip(blockBody(y, k, start)), true) ? 1 : -1;
        y = k;
        break;
      }
    }
    return { blocks, score };
  }
  const asOpener = pairBlocks(false), asCloser = pairBlocks(true);
  const blocks = (asCloser.score > asOpener.score ? asCloser : asOpener).blocks;

  // A markdown table starting at row y, or null. While the cursor is in it, the whole table shows source.
  function tableAt(y) {
    const sep = rows[y + 1]?.text;
    if (!sep || !rows[y].text.includes('|')) return null;
    const g = /^\s*\d+\s+(?=[|:-])/.exec(sep)?.[0].length ?? 0; // an editor's line-number gutter
    if (!TABLE_SEP.test(sep.slice(g)) || !rows[y].text.slice(g).includes('|')) return null;
    let end = y + 1;
    while (end + 1 < rows.length && rows[end + 1].text.slice(g).includes('|')) end++;
    // ponytail: a soft-wrapped row (narrow window) leaves the table as source; reflowing it would need
    // the logical lines joined first.
    for (let k = y + 1; k <= Math.min(end + 1, rows.length - 1); k++) {
      if (b.getLine(b.viewportY + k)?.isWrapped) return null;
    }
    if (cursorRow >= y && cursorRow <= end) return { skip: true, y, rows: end - y + 1 };
    let x0 = term.cols, x1 = 0;
    for (let k = y; k <= end; k++) {
      const { text, col, wid } = rows[k];
      const i0 = g + text.slice(g).search(/\S/), i1 = text.trimEnd().length - 1;
      x0 = Math.min(x0, col[i0]);
      x1 = Math.max(x1, col[i1] + wid[i1]);
    }
    const aligns = splitCells(sep.slice(g)).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
    const fit = (cs) => aligns.map((_, i) => cs[i] ?? '');
    const head = fit(splitCells(rows[y].text.slice(g)));
    const body = rows.slice(y + 2, end + 1).map((r) => fit(splitCells(r.text.slice(g))));
    const c = cell(y, g + rows[y].text.slice(g).search(/\S/));
    const bg = c ? cellColor(c, false) : term.options.theme.background;
    return { table: true, y, rows: end - y + 1, x0, x1, head, aligns, body, bg,
      key: JSON.stringify(['table', x1 - x0, end - y, head, aligns, body, bg]) };
  }

  let inFence = fence0;
  for (let y = 0; y < rows.length; y++) {
    const { text, col, wid } = rows[y];
    if (FENCE.test(text)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const tbl = tableAt(y);
    if (tbl) {
      if (!tbl.skip) found.push(tbl);
      y = tbl.y + tbl.rows - 1;
      continue;
    }
    if (blocks.has(y)) {
      const blk = blocks.get(y);
      if (!blk) continue; // closing `$$` of a block that started above the viewport
      const { end, start } = blk;
      if (cursorRow < y || cursorRow > end) {
        const x1 = Math.max(...rows.slice(y, end + 1).map((r) => {
          const n = r.text.trimEnd().length;
          return n ? r.col[n - 1] + r.wid[n - 1] : 0;
        }));
        const c = cell(y + 1, start) || cell(y, start);
        found.push({ y, rows: end - y + 1, x0: col[start], x1, tex: unstrip(blockBody(y, end, start)), display: true, c });
      }
      y = end;
      continue;
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
      const tex = unstrip((m[1] ?? m[2] ?? m[3] ?? m[4]).trim());
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
  centerDisplay(found);
  return joinRows(found);
}

// Display math is centered on the window (as mdv's is) when its rows, grown ones included, hold nothing
// else. An editor's line-number gutter may sit to the left: it stays visible and the math is centered in
// the rest. Anything else on those rows (a split, text beside a one-line $$..$$) keeps the source position.
function centerDisplay(found) {
  const b = term.buffer.active;
  for (const f of found) {
    if (!f.display) continue;
    const src0 = f.wrapped ? f.pad : f.x0; // wrapped lines already span the row; their source starts at pad
    let gutter = 0, ok = true;
    for (let y = f.top; ok && y < f.top + f.span; y++) {
      const line = b.getLine(b.viewportY + y);
      const left = line?.translateToString(true, 0, src0) ?? '';
      const right = line?.translateToString(true, f.x1, term.cols) ?? '';
      ok = /^\s*\d*\s*$/.test(left) && !right.trim();
      gutter = Math.max(gutter, left.trimEnd().length);
    }
    if (!ok) continue;
    f.x0 = gutter ? gutter + 1 : 0;
    f.x1 = term.cols;
    f.pad = 0;
    f.centered = true;
  }
}

// Math renders narrower than its LaTeX, which left wide gaps before the text that follows it. On a row where
// one-row matches are followed by more text, one overlay covers the row from the first match to the end of
// its text, and lays out the math at its fitted width with the text between and after it redrawn (same
// colors and attributes) right behind it. The real cells stay underneath for selection and copy.
function joinRows(found) {
  const b = term.buffer.active;
  const byRow = new Map();
  for (const f of found) if (f.rows === 1 && !f.wrapped) byRow.set(f.y, [...(byRow.get(f.y) || []), f]);
  const out = found.filter((f) => !byRow.has(f.y) || f.rows !== 1 || f.wrapped);
  for (const [y, ms] of byRow) {
    ms.sort((p, q) => p.x0 - q.x0);
    const line = b.getLine(b.viewportY + y);
    const last = ms[ms.length - 1];
    // End at the row's last text, or before an editor's vertical split.
    let x1 = last.x1;
    for (let x = last.x1; x < term.cols; x++) {
      const ch = line.getCell(x)?.getChars() || ' ';
      if (ch === '│') break;
      if (ch !== ' ') x1 = x + 1;
    }
    if (x1 === last.x1) { out.push(...ms); continue; } // nothing after the math: no gap to close
    const parts = [];
    const text = (a, z) => {
      const runs = [];
      for (let x = a; x < z; x++) {
        const c = line.getCell(x);
        if (!c || c.getWidth() === 0) continue;
        const st = { fg: cellColor(c, true), bg: cellColor(c, false), b: !!c.isBold(), i: !!c.isItalic(),
          u: !!c.isUnderline(), d: !!c.isDim(), s: '' };
        const prev = runs[runs.length - 1];
        if (prev && ['fg', 'bg', 'b', 'i', 'u', 'd'].every((k) => prev[k] === st[k])) prev.s += c.getChars() || ' ';
        else runs.push({ ...st, s: c.getChars() || ' ' });
      }
      if (runs.length) parts.push({ runs, cols: z - a });
    };
    ms.forEach((m, k) => {
      parts.push({ tex: m.tex, display: m.display, cols: m.x1 - m.x0, up: m.y - m.top, span: m.span, overflow: m.overflow,
        fg: m.c ? cellColor(m.c, true) : term.options.theme.foreground });
      text(m.x1, k + 1 < ms.length ? ms[k + 1].x0 : x1);
    });
    const bg = ms[0].c ? cellColor(ms[0].c, false) : term.options.theme.background;
    out.push({ joined: true, y, top: y, x0: ms[0].x0, x1, parts, bg, key: JSON.stringify([x1 - ms[0].x0, bg, parts]) });
  }
  return out;
}

// Give each match `top`/`span`: its rows plus empty rows around it (no text under it, not the cursor row,
// not another match). When two matches share a gap, the upper one gets floor(gap/2) and the lower one
// gets the rest, so they never overlap.
function grow(found, cursorRow) {
  const b = term.buffer.active;
  const taken = new Set();
  for (const f of found) for (let k = 0; k < f.rows; k++) taken.add(f.y + k);
  const left = new Map(); // row -> leftmost one-row match: math on that row can be shifted as far as this
  for (const f of found) if (f.rows === 1 && !f.wrapped) left.set(f.y, Math.min(left.get(f.y) ?? f.x0, f.x0));
  const free = (y, x0, x1) => y >= 0 && y < term.rows && y !== cursorRow && !taken.has(y) &&
    (b.getLine(b.viewportY + y)?.translateToString(true, x0, x1) ?? '').trim() === '';
  for (const f of found) {
    if (f.table) { f.top = f.y; f.span = f.rows; continue; } // tables keep exactly their rows
    const last = f.y + f.rows - 1;
    const x0 = f.rows === 1 && !f.wrapped ? left.get(f.y) : f.x0;
    let up = 0, down = 0;
    while (up < 2 * MAX_GROW && free(f.y - 1 - up, x0, f.x1)) up++;
    while (down < 2 * MAX_GROW && free(last + 1 + down, x0, f.x1)) down++;
    up = Math.min(MAX_GROW, taken.has(f.y - 1 - up) ? Math.ceil(up / 2) : up);
    down = Math.min(MAX_GROW, taken.has(last + 1 + down) ? Math.floor(down / 2) : down);
    if (!f.display) up = down = Math.min(up, down);
    f.top = f.y - up;
    f.span = f.rows + up + down;
    f.overflow = taken.has(f.y - 1) || taken.has(last + 1) ? INLINE_OVERFLOW : LONE_OVERFLOW;
  }
}

// A joined row (see joinRows): math and text laid out left to right, each part right after the previous.
function makeJoined(item, cw, ch) {
  const el = document.createElement('div');
  el.className = 'auto-math';
  Object.assign(el.style, {
    left: `${item.x0 * cw}px`, top: `${item.top * ch}px`, width: `${(item.x1 - item.x0) * cw}px`,
    height: `${ch}px`, background: item.bg,
  });
  autoLayer.appendChild(el);
  let x = 0;
  for (const p of item.parts) {
    const inner = document.createElement('div');
    inner.style.left = `${x}px`;
    el.appendChild(inner);
    if (p.runs) {
      inner.className = 'auto-text';
      Object.assign(inner.style, { font: `${term.options.fontSize}px ${term.options.fontFamily}`, lineHeight: `${ch}px` });
      for (const r of p.runs) {
        const sp = document.createElement('span');
        sp.textContent = r.s;
        Object.assign(sp.style, { color: r.fg, background: r.bg, fontWeight: r.b ? 'bold' : '',
          fontStyle: r.i ? 'italic' : '', textDecoration: r.u ? 'underline' : '', opacity: r.d ? 0.5 : '' });
        inner.appendChild(sp);
      }
      x += p.cols * cw;
    } else {
      const html = katexHtml(p.tex, p.display);
      inner.innerHTML = html;
      inner.style.color = p.fg;
      // grown math stays centered on this row, so it may extend past the 1-row box
      const maxH = p.span === 1 ? ch * p.overflow : (p.span - 2 * GROW_MARGIN) * ch;
      fitInk(inner, p.cols * cw, maxH);
      x += Math.min(p.cols * cw, inner.getBoundingClientRect().width);
    }
  }
  return el;
}

// A table row's cells. `|` inside math or code spans, or escaped as `\|`, doesn't split.
function splitCells(row) {
  row = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  const out = [];
  let cur = '', math = false, code = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\' && row[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '`' && !math) code = !code;
    if (ch === '$' && !code) math = !math;
    if (ch === '|' && !math && !code) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

// Inline markdown in a table cell, as HTML: math, `code`, **bold**, *italic* / _italic_, ~~struck~~.
function cellHtml(src) {
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const keep = []; // finished HTML for code and math, swapped back in after the emphasis pass
  const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`;
  let s = src.replace(/`([^`]+)`/g, (_, code) => hold(`<code style="color:${term.options.theme.yellow}">${esc(code)}</code>`));
  s = s.replace(INLINE_RX, (m, a, b, c, d) => {
    const html = katexHtml(unstrip((a ?? b ?? c ?? d).trim()), false);
    return html ? hold(html) : m;
  });
  s = esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '<i>$1</i>')
    .replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<i>$1</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}

// A markdown table drawn over its source rows: the header takes the header and separator rows, then one
// row per body row. Scaled down if it doesn't fit (tall math in a cell, or rendering wider than the source).
function makeTable(item, cw, ch) {
  const el = document.createElement('div');
  el.className = 'auto-math';
  const w = (item.x1 - item.x0) * cw, h = item.rows * ch;
  Object.assign(el.style, { left: `${item.x0 * cw}px`, top: `${item.top * ch}px`, width: `${w}px`, height: `${h}px`,
    background: item.bg, color: term.options.theme.foreground });
  const table = document.createElement('table');
  table.className = 'auto-table';
  table.style.font = `${term.options.fontSize}px ${term.options.fontFamily}`;
  const addRow = (cells, tag, rowH) => {
    const tr = table.insertRow();
    cells.forEach((c, i) => {
      const td = document.createElement(tag);
      td.innerHTML = cellHtml(c);
      Object.assign(td.style, { textAlign: item.aligns[i], height: `${rowH - 1}px` }); // -1: the shared border
      tr.appendChild(td);
    });
  };
  addRow(item.head, 'th', 2 * ch);
  for (const r of item.body) addRow(r, 'td', ch);
  el.appendChild(table);
  autoLayer.appendChild(el);
  const r = table.getBoundingClientRect();
  const s = Math.min(1, w / r.width, h / r.height);
  if (s < 1) table.style.transform = `scale(${s})`;
  return el;
}

function makeOverlay(item, cw, ch) {
  if (item.table) return makeTable(item, cw, ch);
  if (item.joined) return makeJoined(item, cw, ch);
  const html = katexHtml(item.tex, item.display);
  if (!html) return null;
  const el = document.createElement('div');
  const block = item.display && item.rows > 1 && !item.wrapped; // multi-row $$ block: centered both ways
  el.className = `auto-math${block ? ' block' : ''}`;
  Object.assign(el.style, {
    left: `${item.x0 * cw}px`, top: `${item.top * ch}px`,
    width: `${(item.x1 - item.x0) * cw}px`, height: `${item.span * ch}px`,
    color: item.c ? cellColor(item.c, true) : term.options.theme.foreground,
    background: item.c ? cellColor(item.c, false) : term.options.theme.background,
  });
  const inner = document.createElement('div');
  inner.innerHTML = html;
  const pad = (item.pad || 0) * cw; // wrapped lines: keep the source's indent
  if (pad) inner.style.left = `${pad}px`;
  el.appendChild(inner);
  autoLayer.appendChild(el);
  const grew = item.span > item.rows;
  const maxH = item.span === 1 ? ch * item.overflow : (item.span - (grew ? 2 * GROW_MARGIN : 0)) * ch;
  if (block) {
    const r = inner.getBoundingClientRect();
    const s = Math.min(1, (item.x1 - item.x0) * cw / r.width, maxH / r.height);
    inner.style.transform = `translate(-50%, -50%) scale(${s})`;
  } else {
    fitInk(inner, (item.x1 - item.x0) * cw - pad, maxH); // from renderer.js: fit and center by ink height
    if (item.centered) inner.style.left = `${((item.x1 - item.x0) * cw - inner.getBoundingClientRect().width) / 2}px`;
  }
  return el;
}

// Ignore list: while the foreground program was started on a matching file (e.g. `nvim hw7.tex`), or the
// window title names one (nvim with `set title` updates it on :e), detection pauses. Patterns are globs
// matched against the basename of every argument, so a program name ("htop") works too.
const DEFAULT_IGNORE = ['*.tex', '*.sty', '*.cls'];
let ignoredBy = null; // the matching argument while paused
let title = '';
term.onTitleChange((t) => { title = t; checkIgnore(); });

function globToRegex(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`, 'i');
}
function ignoreMatch(text) {
  const pats = (config.autoDetectIgnore ?? DEFAULT_IGNORE).map(globToRegex);
  for (const tok of text.split(/[\s()"']+/)) {
    const base = tok.split('/').pop();
    if (base && pats.some((rx) => rx.test(base))) return base;
  }
  return null;
}
async function checkIgnore() {
  const args = await invoke('foreground').catch(() => '');
  const hit = ignoreMatch(args) || ignoreMatch(title);
  if (hit === ignoredBy) return;
  ignoredBy = hit;
  if (hit && autoMath) flash(`auto math paused for ${hit}`, 2000);
  queueScan();
}
setInterval(checkIgnore, 500);

let scanQueued = false;
function scan() {
  scanQueued = false;
  const old = autoEls;
  autoEls = new Map();
  if (autoMath && !ignoredBy) {
    const [cw, ch] = cellSize();
    for (const it of findMath()) {
      // Position is left out so that scrolling moves existing overlays instead of rebuilding them.
      const key = it.key ? `${it.key}|${cw}|${ch}` : [it.span, it.overflow, it.y - it.top, it.rows, it.x1 - it.x0, it.pad, it.display, it.tex,
        it.c && cellColor(it.c, true), it.c && cellColor(it.c, false), cw, ch].join('|');
      const pool = old.get(key) || [];
      let i = pool.findIndex((o) => o.top === it.top && o.x0 === it.x0);
      if (i < 0) i = pool.length - 1;
      let o = i >= 0 ? pool.splice(i, 1)[0] : null;
      if (o) {
        Object.assign(o.el.style, { left: `${it.x0 * cw}px`, top: `${it.top * ch}px` });
      } else {
        const el = makeOverlay(it, cw, ch);
        if (!el) continue;
        o = { el };
      }
      o.top = it.top; o.x0 = it.x0;
      autoEls.set(key, [...(autoEls.get(key) || []), o]);
    }
  }
  for (const pool of old.values()) for (const o of pool) o.el.remove();
}
function queueScan() {
  if (!scanQueued) { scanQueued = true; requestAnimationFrame(scan); }
}

term.onRender(scan); // same frame as xterm's paint, so overlays never lag the text by a frame
// Overlays are measured when built and then reused, so ones built before KaTeX's fonts arrived (fallback
// glyphs) would keep the wrong width. Rebuild everything once they're in.
katexFonts.then(() => {
  for (const pool of autoEls.values()) for (const o of pool) o.el.remove();
  autoEls.clear();
  queueScan();
});
term.onScroll(queueScan);
term.onResize(queueScan);
term.onCursorMove(queueScan);

keyBindings.push((e) => {
  if (!(e.metaKey && e.shiftKey && e.key.toLowerCase() === 'm')) return false;
  autoMath = !autoMath;
  flash(`auto math: ${autoMath ? 'on' : 'off'}${autoMath && ignoredBy ? ` (paused for ${ignoredBy})` : ''}  ·  ⌘⇧M`, 1500);
  queueScan();
  return true;
});
