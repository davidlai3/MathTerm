// Replay a debug capture (Cmd-Shift-D in mathterm, ~/mathterm-debug-*.jsonl) into a headless xterm and diff
// the result against the screen the app had. Same screen: the bytes themselves produce it (emulation, or the
// program). Different: the app's xterm ended up somewhere the bytes don't lead (drawing, or lost bytes).
// Usage: node test/replay.js ~/mathterm-debug-123.jsonl
const fs = require('node:fs');
const { Terminal } = require('@xterm/headless');

const [head, ...chunks] = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => JSON.parse(l));
const first = chunks[0] ?? head;
const term = new Terminal({ cols: first.cols, rows: first.rows, allowProposedApi: true });
const write = (d) => new Promise((r) => term.write(d, r));

(async () => {
  for (const c of chunks) {
    if (c.cols !== term.cols || c.rows !== term.rows) term.resize(c.cols, c.rows);
    await write(c.d);
  }
  if (head.cols !== term.cols || head.rows !== term.rows) term.resize(head.cols, head.rows);
  await write('');
  const b = term.buffer.active;
  const replay = Array.from({ length: term.rows }, (_, y) => b.getLine(b.viewportY + y)?.translateToString(true) ?? '');
  const diff = head.screen.map((l, y) => (l === replay[y] ? null : `${y}:\n  app:    ${JSON.stringify(l)}\n  replay: ${JSON.stringify(replay[y])}`)).filter(Boolean);
  console.log(`${chunks.length} chunks, ${head.cols}x${head.rows}, alt=${head.alt} (replay alt=${b.type === 'alternate'})${head.truncated ? ', TRUNCATED' : ''}`);
  console.log(diff.length ? `${diff.length} rows differ:\n${diff.join('\n')}` : 'replay matches the app screen');
})();
