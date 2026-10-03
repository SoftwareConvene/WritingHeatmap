// Google Docs keeps structure inline in the text as control and private-use
// characters (table and cell markers, soft line breaks, smart chips). The
// analysis keeps every character so positions stay exact; only what a reader
// sees goes through displayChar.

export function displayChar(c) {
  const code = c.charCodeAt(0);
  if (c === '\n' || c === '\t') return c;
  if (code === 0x0b) return '\n';                     // soft line break
  if (code < 0x20) return code >= 0x10 ? ' ' : '';    // table/cell/row markers read as a gap
  if (code >= 0xe000 && code <= 0xf8ff) return '';    // smart chips, footnote anchors
  if (code === 0xfeff) return '';
  return c;
}

export function displayText(s) {
  // Code units, not code points: positions in the history count UTF-16 units,
  // and a surrogate half passes through unchanged so emoji reassemble.
  let out = '';
  for (let i = 0; i < s.length; i++) out += displayChar(s[i]);
  return out;
}
