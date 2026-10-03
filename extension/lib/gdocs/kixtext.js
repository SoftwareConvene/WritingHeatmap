// Google Docs keeps structure inline in the text as control and private-use
// characters (table and cell markers, soft line breaks, smart chips). The
// analysis keeps every character so positions stay exact; only what a reader
// sees goes through displayChar.

// Table structure markers. The viewer turns them back into a real table.
export const STRUCT = Object.freeze({ TABLE_START: '\u0010', TABLE_END: '\u0011', ROW: '\u0012', CELL: '\u001c' });
const STRUCT_SET = new Set(Object.values(STRUCT));

export function isStructure(c) {
  return STRUCT_SET.has(c);
}

// keepStructure: leave table markers in place for the viewer's layout;
// otherwise rows read as new lines and cells as tabs.
export function displayChar(c, keepStructure = false) {
  const code = c.charCodeAt(0);
  if (c === '\n' || c === '\t') return c;
  if (STRUCT_SET.has(c)) return keepStructure ? c : (c === STRUCT.CELL ? '\t' : '\n');
  if (code === 0x0b) return '\n';                     // soft line break
  if (code < 0x20) return code >= 0x10 ? ' ' : '';    // other structure reads as a gap
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

// Characters that are layout, not writing: never counted as text.
export function isBlank(c) {
  return /\s/.test(c) || c.charCodeAt(0) < 0x20;
}
