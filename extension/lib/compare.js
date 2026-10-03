// Checks the rebuilt text against Google's own copy of the document. Where
// they disagree the history did not explain the text, so those paragraphs are
// shown as "History unclear" instead of in a colour that might be wrong.

const BULLET = /^[*•●○■□◦▪‣–-]\s+/;

export function normLine(s) {
  return s
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(BULLET, '');
}

export function lines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(normLine).filter(Boolean);
}

// rebuiltParas: paragraph strings in display order. reference: Google's text.
// -> { status, ratio, mismatched: Set<paragraph index> }
export function compareText(rebuiltParas, reference) {
  if (reference == null) return { status: 'unverified', ratio: null, mismatched: new Set() };
  const pool = new Map();
  for (const l of lines(reference)) pool.set(l, (pool.get(l) || 0) + 1);
  const mismatched = new Set();
  let checked = 0, ok = 0;
  rebuiltParas.forEach((p, idx) => {
    const l = normLine(p);
    if (!l) return;
    checked++;
    const left = pool.get(l) || 0;
    if (left > 0) { pool.set(l, left - 1); ok++; } else mismatched.add(idx);
  });
  const extra = [...pool.values()].reduce((a, b) => a + b, 0);
  const ratio = checked + extra ? ok / (checked + extra) : 1;
  const status = ratio === 1 ? 'exact' : ratio >= 0.9 ? 'close' : 'mismatch';
  return { status, ratio, mismatched };
}
