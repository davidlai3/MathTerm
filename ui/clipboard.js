// OSC 52 clipboard writes: ESC ] 52 ; <selection> ; <base64> (BEL | ST), from nvim, tmux (set-clipboard on), ssh.
// Every selection (c, p, s, empty, ...) goes to the macOS clipboard: there's no primary selection to tell apart.
// Reads (`?`) are ignored, so remote programs can't see the clipboard. Invalid base64 / UTF-8 is ignored.
// xterm's OSC parser takes BEL and ST and payloads up to 10 MB (longer ones are dropped whole).
const utf8 = new TextDecoder('utf-8', { fatal: true });

// The text an OSC 52 payload (after "52;") asks to copy, or null if it's a read or malformed.
function osc52Text(payload) {
  const i = payload.indexOf(';');
  if (i < 0) return null;
  const data = payload.slice(i + 1);
  if (data === '?') return null;
  try {
    return utf8.decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function initOsc52(term, copy) {
  term.parser.registerOscHandler(52, (payload) => {
    const text = osc52Text(payload);
    if (text !== null) copy(text);
    return true;
  });
}
