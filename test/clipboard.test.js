// OSC 52 (ui/clipboard.js) through a real headless xterm parser: terminators, length, malformed input.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Terminal } = require('@xterm/headless');

const ctx = vm.createContext({ atob, TextDecoder, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ui', 'clipboard.js'), 'utf8'), ctx);

// Writes s to a terminal with OSC 52 hooked up; returns what was copied (one entry per write).
async function copied(s) {
  const term = new Terminal({ allowProposedApi: true });
  const out = [];
  ctx.initOsc52(term, (t) => out.push(t));
  await new Promise((r) => term.write(s, r));
  return out;
}
const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
const BEL = '\x07', ST = '\x1b\\';

test('selection c, BEL', async () => {
  assert.deepEqual(await copied(`\x1b]52;c;${b64('hello from osc52')}${BEL}`), ['hello from osc52']);
});
test('empty selection (tmux)', async () => {
  assert.deepEqual(await copied(`\x1b]52;;${b64('x')}${BEL}`), ['x']);
});
test('ST terminator (nvim), p and cp selections, UTF-8', async () => {
  assert.deepEqual(await copied(`\x1b]52;p;${b64('st works ∫')}${ST}\x1b]52;cp;${b64('é')}${ST}`), ['st works ∫', 'é']);
});
test('~100KB payload is copied whole', async () => {
  const text = 'abcdefghij\n'.repeat(9500);
  const [got] = await copied(`\x1b]52;c;${b64(text)}${BEL}`);
  assert.equal(got.length, text.length);
  assert.equal(got, text);
});
test('invalid base64 / UTF-8 is ignored, and the terminal keeps working', async () => {
  assert.deepEqual(await copied(`\x1b]52;c;!!!${BEL}\x1b]52;c;/w==${BEL}\x1b]52;c;${b64('ok')}${BEL}`), ['ok']);
});
test('? query is ignored (no clipboard read)', async () => {
  assert.deepEqual(await copied(`\x1b]52;c;?${BEL}\x1b]52;c${BEL}`), []);
});
