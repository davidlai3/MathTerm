// Auto-detect tests: ui/automath.js runs against a real (headless) xterm buffer, with renderer.js's
// DOM helpers stubbed. Covers detection and layout decisions (findMath: what's typeset, where, how many
// rows), not pixels: overlay sizing needs the webview (`npm run shot`).
// `todo` tests are known bugs (notes/plans.md): they report but don't fail the run. Drop `todo` when fixed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const katex = require('katex');
const { Terminal } = require('@xterm/headless');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'ui', f), 'utf8');
const THEMES = src('themes.js'), AUTOMATH = src('automath.js');

// A terminal with automath.js loaded. `screen(lines, opts)` writes them, parks the cursor and returns
// findMath()'s items, trimmed to the fields worth asserting on.
function setup({ cols = 80, rows = 24, config = {} } = {}) {
  const term = new Terminal({ cols, rows, allowProposedApi: true });
  const clock = { t: 1e6 };
  const ctx = vm.createContext({
    term, katex, config, console, setTimeout,
    rawSpans: [], INLINE_OVERFLOW: 1.0, keyBindings: [],
    cellSize: () => [8, 16], fitInk() {}, flash() {}, invoke: async () => '',
    katexFonts: new Promise(() => {}), setInterval: () => 0, requestAnimationFrame: () => 0,
    performance: { now: () => clock.t },
    document: { createElement: () => ({}) },
  });
  vm.runInContext(THEMES, ctx);
  term.options.theme = Object.fromEntries([['foreground', '#ffffff'], ['background', '#000000'],
    ...vm.runInContext('ANSI_KEYS', ctx).map((k, i) => [k, `#0000${i.toString(16).padStart(2, '0')}`])]);
  Object.defineProperty(term, 'element', { value: { querySelector: () => ({ appendChild() {} }) } });
  term.onRender = () => {};
  vm.runInContext(AUTOMATH, ctx);
  const write = (s) => new Promise((r) => term.write(s, r));
  // Values from the vm context are another realm's arrays (deepEqual rejects them), so results are cloned.
  const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const g = (name) => {
    const v = vm.runInContext(name, ctx);
    return typeof v === 'function' ? (...a) => plain(v(...a)) : v;
  };
  // cursor: [row, col] (0-based) to leave it on; false hides it (and lets HIDE_GRACE pass). Default: on a
  // new blank row after the text, like a shell prompt.
  async function screen(lines, { cursor } = {}) {
    await write(lines.join('\r\n'));
    if (cursor === false) { await write('\x1b[?25l'); clock.t += 1000; }
    else if (cursor) await write(`\x1b[${cursor[0] + 1};${cursor[1] + 1}H`);
    else await write('\r\n');
    return plain(vm.runInContext('findMath()', ctx).map(pick));
  }
  return { term, write, screen, g };
}
const pick = (f) => Object.fromEntries(Object.entries({
  y: f.y, rows: f.rows, x0: f.x0, x1: f.x1, top: f.top, span: f.span, tex: f.tex, display: f.display,
  centered: f.centered, wrapped: f.wrapped, table: f.table, joined: f.joined, reflow: f.reflow,
  head: f.head, body: f.body, parts: (f.parts ?? f.segs)?.map((p) => p.tex ?? p.runs.map((r) => r.s).join('')),
}).filter(([, v]) => v !== undefined));
const texs = (found) => found.flatMap((f) => (f.joined ? f.parts.filter((_, i) => i % 2 === 0)
  : f.reflow ? f.parts.filter((p) => !p.includes(' ') && !/^[a-z]+$/.test(p)) : [f.tex]));

// ---- inline math ----

test('inline $..$ covers exactly its cells', async () => {
  const f = await setup().screen(['area is $x^2$ here']);
  assert.deepEqual(texs(f), ['x^2']);
  const j = f[0];
  assert.ok(j.joined, 'text after the math is joined into the overlay');
  assert.equal(j.x0, 8);
  assert.equal(j.x1, 18);
});

test('lone inline math at the end of a row is a plain overlay', async () => {
  const [f] = await setup().screen(['area is $x^2$']);
  assert.equal(f.joined, undefined);
  assert.deepEqual([f.x0, f.x1, f.tex, f.display], [8, 13, 'x^2', false]);
});

test('all four delimiters', async () => {
  const f = await setup().screen(['$a$', '', '\\(b\\)', '', '$$c$$', '', '\\[d\\]']);
  assert.deepEqual(f.map((x) => [x.tex, x.display]), [['a', false], ['b', false], ['c', true], ['d', true]]);
});

test('currency and spaced dollars are not math', async () => {
  assert.deepEqual(await setup().screen(['costs $5 and $10 total', 'a $ b $ c', 'escaped \\$x$']), []);
});

test('inline `code` is skipped, math after it is not', async () => {
  const f = await setup().screen(['run `echo $HOME$` then $y$']);
  assert.deepEqual(texs(f), ['y']);
});

test('``` fences are skipped', async () => {
  assert.deepEqual(await setup().screen(['```', '$x$', '$$', 'y', '$$', '```']), []);
});

test('fence opened above the viewport is still a fence', async () => {
  const lines = ['```', ...Array.from({ length: 30 }, (_, i) => `code ${i}`), '$x$', '$$y$$'];
  assert.deepEqual(await setup({ rows: 10 }).screen(lines), []);
});

test('cursor row shows source', async () => {
  const t = setup();
  assert.deepEqual(await t.screen(['$x$', '$y$'], { cursor: [0, 1] }).then(texs), ['y']);
});

test('hidden cursor (Claude Code) does not block its row', async () => {
  assert.deepEqual(await setup().screen(['$x$'], { cursor: false }).then(texs), ['x']);
});

test('wide characters before math keep cell columns', async () => {
  const [f] = await setup().screen(['中文 $x$']);
  assert.deepEqual([f.x0, f.x1], [5, 8]);
});

test('raw spans (OSC 7777;raw) are never typeset', async () => {
  const t = setup();
  await t.write('$x$');
  t.g('rawSpans').push({ marker: t.term.registerMarker(0), offset: 0, len: 3 });
  assert.deepEqual(await t.screen([]), []);
});

test('two matches with text between are joined, text redrawn in between', async () => {
  const [f] = await setup().screen(['$a$ and $b$ end']);
  assert.ok(f.joined);
  assert.deepEqual(f.parts, ['a', ' and ', 'b', ' end']);
});

test('matches are not joined across a box-drawn │', async () => {
  const f = await setup().screen(['│ $a$ │ text │ $b$ │']);
  assert.equal(f.length, 2);
});

// ---- growing and centering ----

test('one-line $$..$$ between blank rows grows and centers', async () => {
  const [f] = await setup().screen(['text', '', '', '', '$$E=mc^2$$', '', '', '', 'more']);
  assert.deepEqual([f.y, f.top, f.span, f.centered, f.x0, f.x1], [4, 1, 7, true, 0, 80]);
});

test('inline math grows symmetrically', async () => {
  const [f] = await setup().screen(['', '', '$x$', '', 'text']);
  assert.deepEqual([f.top, f.span], [1, 3]);
});

test('two display lines share the gap between them', async () => {
  const f = await setup().screen(['$$a$$', '', '', '', '$$b$$']);
  assert.equal(f[0].top + f[0].span, f[1].top, 'touching, not overlapping');
});

test('display math beside text keeps its position', async () => {
  const [f] = await setup().screen(['so $$a=b$$ holds']);
  assert.equal(f.centered, undefined);
});

test('editor line-number gutter stays visible when centering', async () => {
  const [f] = await setup().screen(['  12 $$a=b$$']);
  assert.deepEqual([f.centered, f.x0], [true, 5]);
});

// ---- multi-row blocks ----

test('$$ block on its own rows', async () => {
  const [f] = await setup().screen(['$$', 'a + b', '= c', '$$']);
  assert.deepEqual([f.y, f.rows, f.tex.replace(/\s+/g, ' '), f.display], [0, 4, 'a + b = c', true]);
});

test('\\[ block', async () => {
  const [f] = await setup().screen(['\\[', 'x', '\\]']);
  assert.deepEqual([f.rows, f.tex], [3, 'x']);
});

test('block with the cursor inside shows source', async () => {
  assert.deepEqual(await setup().screen(['$$', 'x', '$$'], { cursor: [1, 0] }), []);
});

test('block whose opener scrolled off: stray closer does not shift later pairs', async () => {
  const f = await setup().screen(['x^2', '$$', 'where $a$ is real', '$$', '\\frac{a}{b}', '$$'], { cursor: false });
  assert.deepEqual(texs(f).sort(), ['\\frac{a}{b}', 'a'], 'the block, plus the inline $a$ in the prose row');
});

test('soft-wrapped block row joins without a space', async () => {
  const f = await setup({ cols: 20 }).screen(['$$', '\\underbrace{a+b}_{n}', '$$']);
  assert.deepEqual(texs(f), ['\\underbrace{a+b}_{n}']);
});

test('nvim line numbers before $$ rows', async () => {
  const [f] = await setup().screen(['  1 $$', '  2 x', '  3 $$']);
  assert.equal(f.tex, 'x');
});

// ---- soft wraps ----

test('long display line wrapped alone on its rows covers them full-width', async () => {
  const tex = 'a + '.repeat(15) + 'b';
  const [f] = await setup({ cols: 40 }).screen([`  $$${tex}$$`]);
  assert.deepEqual([f.wrapped, f.rows, f.x0, f.x1, f.tex], [true, 2, 0, 40, tex]);
});

test('inline math wrapped mid-sentence reflows the whole line', async () => {
  const [f] = await setup({ cols: 20 }).screen(['some words and $x^2+y^2$ more', 'next']);
  assert.deepEqual([f.reflow, f.y, f.rows, f.x0, f.x1, f.top, f.span], [true, 0, 2, 0, 20, 0, 2]);
  assert.deepEqual(f.parts, ['some words and ', 'x^2+y^2', ' more']);
});

test('wrapped line with one-row math reflows too (no word split at the edge)', async () => {
  const [f] = await setup({ cols: 20 }).screen(['$a$ then some words for you']);
  assert.ok(f.reflow);
  assert.deepEqual(f.parts, ['a', ' then some words for you']);
});

test('cursor on any row of a wrapped line shows its source', async () => {
  assert.deepEqual(await setup({ cols: 20 }).screen(['some words and $x^2+y^2$ more'], { cursor: [1, 3] }), []);
});

test('inline code in a wrapped line stays text', async () => {
  const [f] = await setup({ cols: 20 }).screen(['run `$x$` and then $y$ ok']);
  assert.deepEqual(f.parts, ['run `$x$` and then ', 'y', ' ok']);
});

// ---- panes ----

test('tmux side-by-side panes are scanned separately', async () => {
  const rows = 10, lines = [];
  for (let y = 0; y < rows - 1; y++) {
    const l = y === 1 ? '$$' : y === 2 ? 'x^2' : y === 3 ? '$$' : '';
    const r = y === 5 ? '$y$' : '';
    lines.push(l.padEnd(39) + '│' + r);
  }
  const f = await setup({ rows }).screen(lines, { cursor: [0, 45] });
  assert.deepEqual(f.map((x) => [x.tex, x.x0 >= 40]), [['x^2', false], ['y', true]]);
});

// ---- tables ----

test('GFM table with math in a cell', async () => {
  const [f] = await setup().screen(['| a | b |', '|:-|-:|', '| $x$ | 2 |']);
  assert.ok(f.table);
  assert.deepEqual([f.head, f.body], [['a', 'b'], [['$x$', '2']]]);
});

test('autoDetectTables: false leaves the table but typesets its math', async () => {
  const f = await setup({ config: { autoDetectTables: false } }).screen(['| a |', '|---|', '| $x$ |']);
  assert.deepEqual(texs(f), ['x']);
});

test('cursor in a table shows source', async () => {
  assert.deepEqual(await setup().screen(['| a |', '|---|', '| b |'], { cursor: [2, 1] }), []);
});

// ---- pure helpers ----

test('unstrip repairs eaten escapes', () => {
  const u = setup().g('unstrip');
  assert.equal(u('\\sin!\\left(x\\right)'), '\\sin\\!\\left(x\\right)');
  assert.equal(u('O!\\left(n\\right)'), 'O\\!\\left(n\\right)');
  assert.equal(u('n!'), 'n!');
  assert.equal(u('\\underbrace{a+b}{n}'), '\\underbrace{a+b}_{n}');
  assert.equal(u('\\underbrace{a+b}_{n}'), '\\underbrace{a+b}_{n}');
  assert.equal(u('a,\\times,b'), 'a\\,\\times\\,b');
  assert.equal(u('\\begin{bmatrix}1 & 2 \\ 3 & 4\\end{bmatrix}'), '\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}');
  assert.equal(u('a\\ b'), 'a\\ b', 'control space outside environments is left alone');
});

test('splitCells keeps | inside math, code and \\|', () => {
  const s = setup().g('splitCells');
  assert.deepEqual(s('| $|x|$ | `a|b` | c\\|d |'), ['$|x|$', '`a|b`', 'c|d']);
});

test('cellHtml: emphasis, code, math', () => {
  const h = setup().g('cellHtml');
  assert.match(h('**b** *i* ~~s~~'), /<b>b<\/b> <i>i<\/i> <s>s<\/s>/);
  assert.match(h('`a<b`'), /<code[^>]*>a&lt;b<\/code>/);
  assert.match(h('$x$'), /class="katex"/);
  assert.equal(h('snake_case_name'), 'snake_case_name');
});

test('ignore list matches argument basenames', () => {
  const t = setup();
  const m = t.g('ignoreMatch');
  assert.equal(m('nvim /home/u/hw7.tex'), 'hw7.tex');
  assert.equal(m('nvim notes.md'), null);
  assert.equal(m('vim My Paper.TEX'), 'Paper.TEX', 'ps does not quote: a name with spaces still matches');
});

test('invalid LaTeX does not render', () => {
  assert.equal(setup().g('katexHtml')('\\frac{', false), null);
});

// ---- known bugs (notes/plans.md) ----



test('soft-wrapped table row still renders as a table', { todo: 'plans.md: Tables' }, async () => {
  const f = await setup({ cols: 20 }).screen(['| a | b |', '|---|---|', '| a long cell here | 2 |']);
  assert.ok(f[0]?.table);
});

test('fence opened beyond FENCE_LOOKBACK rows up', { todo: 'automath.js: FENCE_LOOKBACK' }, async () => {
  const lines = ['```', ...Array.from({ length: 250 }, (_, i) => `code ${i}`), '$x$'];
  assert.deepEqual(await setup({ rows: 10 }).screen(lines), []);
});

test('$$ block cut off at the top does not show its body raw', { todo: 'plans.md: Scroll flicker' }, async () => {
  const f = await setup().screen(['\\frac{a}{b}', '$$', 'text'], { cursor: false });
  assert.ok(f.some((x) => x.tex === '\\frac{a}{b}'));
});

test('\\[ block whose \\[ is off-screen', { todo: 'plans.md: Scroll flicker' }, async () => {
  const f = await setup().screen(['x^2', '\\]', 'text'], { cursor: false });
  assert.ok(f.some((x) => x.tex === 'x^2'));
});

test('code block without fences (shared background) is skipped', { todo: 'plans.md: Code without fences' }, async () => {
  const bg = '\x1b[48;5;236m';
  assert.deepEqual(await setup().screen([`${bg}echo $PATH$ ok\x1b[0m`, `${bg}x=$y$\x1b[0m`]), []);
});
