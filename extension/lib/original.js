// "As first added": for a passage that came mostly from large insertions, the
// text those insertions put in, so it can be set beside what is there now.

import { displayText } from './gdocs/kixtext.js';

const MIN_CHARS = 20;          // large-insertion characters needed in the passage
const MIN_SHARE = 0.25;        // ...and their share of its non-space characters
const MAX_ORIGINAL = 3000;     // characters kept per passage
const MAX_DIFF_CELLS = 1.5e6;  // word-diff table size before giving up on marks

// Offsets of each large insertion's characters still anywhere in the document.
// recs: every surviving char record. -> Map(ev -> Set(off))
export function survivingOffsets(recs, largeInsertion) {
  const out = new Map();
  for (const r of recs) {
    if (r.pre || r.batch < largeInsertion) continue;
    let set = out.get(r.ev);
    if (!set) out.set(r.ev, (set = new Set()));
    set.add(r.off);
  }
  return out;
}

const isStop = (text, k) => text[k] === '\n' || (/[.!?]/.test(text[k]) && (k + 1 >= text.length || /\s/.test(text[k + 1])));

// The original text behind one passage, or null when there is nothing to
// compare. recs: the passage's char records in order. events: by index.
// survivors: from survivingOffsets(). now: the passage text as it reads today.
export function originalOf(recs, events, survivors, now, { largeInsertion }) {
  const nonSpace = recs.filter((r) => !/\s/.test(r.c));
  const large = nonSpace.filter((r) => !r.pre && r.batch >= largeInsertion);
  if (large.length < MIN_CHARS || large.length < MIN_SHARE * nonSpace.length) return null;

  // Each insertion's range of offsets in this passage, in passage order.
  const ranges = new Map();
  for (const r of recs) {
    if (r.pre || r.batch < largeInsertion) continue;
    const g = ranges.get(r.ev);
    if (g) { g.lo = Math.min(g.lo, r.off); g.hi = Math.max(g.hi, r.off); } else ranges.set(r.ev, { lo: r.off, hi: r.off });
  }
  const pieces = [];
  for (const [i, g] of ranges) {
    const ev = events[i];
    if (!ev || !ev.text) continue;
    const text = ev.text;
    const alive = survivors.get(i) || new Set();
    // Widen over characters that were later deleted, so text removed at the
    // passage's edges shows, but stop at a sentence end and never take text
    // that still survives somewhere else.
    let lo = g.lo, hi = g.hi;
    while (lo > 0 && !alive.has(lo - 1) && !isStop(text, lo - 1)) lo--;
    while (hi + 1 < text.length && !alive.has(hi + 1) && !isStop(text, hi)) hi++;
    let piece = displayText(text.slice(lo, hi + 1)).trim();
    if (piece.length > MAX_ORIGINAL) piece = `${piece.slice(0, MAX_ORIGINAL)}…`;
    if (piece) pieces.push({ ev: i, t: ev.t, actor: ev.actor, n: text.length, text: piece });
  }
  if (!pieces.length) return null;
  const text = pieces.map((p) => p.text).join('\n');
  const nowText = displayText(now).trim();
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  if (norm(text) === norm(nowText)) return null;
  const diff = diffWords(text, nowText);
  return { pieces, text, diff, now: diff ? undefined : nowText, ...diffCounts(diff) };
}

// Word-level difference: [{ op: 'same' | 'del' | 'ins', text }], or null when
// the texts are too long to compare.
export function diffWords(a, b) {
  const A = a.match(/\s+|[^\s]+/g) || [];
  const B = b.match(/\s+|[^\s]+/g) || [];
  if ((A.length + 1) * (B.length + 1) > MAX_DIFF_CELLS) return null;
  const W = B.length + 1;
  const L = new Uint32Array((A.length + 1) * W);
  const same = (x, y) => x === y || (/^\s+$/.test(x) && /^\s+$/.test(y));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      L[i * W + j] = same(A[i], B[j]) ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  const out = [];
  const push = (op, text) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (same(A[i], B[j])) { push('same', B[j]); i++; j++; }
    else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) push('del', A[i++]);
    else push('ins', B[j++]);
  }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('ins', B[j++]);
  return group(out);
}

// "quick brown fox" -> "slow red hen" reads as one change, not three: a lone
// space kept between two changes joins them, and each run of changes becomes
// one removal followed by one addition.
function group(parts) {
  const out = [];
  let del = '', ins = '';
  const flush = () => {
    if (del) out.push({ op: 'del', text: del });
    if (ins) out.push({ op: 'ins', text: ins });
    del = ''; ins = '';
  };
  parts.forEach((p, k) => {
    const between = p.op === 'same' && /^\s+$/.test(p.text) && k > 0 && k < parts.length - 1 && parts[k + 1].op !== 'same' && (del || ins);
    if (p.op === 'del') del += p.text;
    else if (p.op === 'ins') ins += p.text;
    else if (between) { del += p.text; ins += p.text; }
    else { flush(); out.push({ ...p }); }
  });
  flush();
  return out;
}

const words = (s) => (s.match(/\S+/g) || []).length;

function diffCounts(diff) {
  if (!diff) return { removed: null, added: null, kept: null };
  let removed = 0, added = 0, kept = 0;
  for (const d of diff) {
    if (d.op === 'del') removed += words(d.text);
    else if (d.op === 'ins') added += words(d.text);
    else kept += words(d.text);
  }
  return { removed, added, kept };
}
