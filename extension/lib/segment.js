// Splits the finished text into the passages the heatmap colours: sentences
// by default, split further when one sentence holds clearly different
// histories (research §4.3).

import { displayChar } from './gdocs/kixtext.js';

export const SEGMENT = Object.freeze({ MIN_SUBSPAN: 20 });

// What a reader sees, plus which char record each visible character is.
export function displayOf(arr) {
  let text = '';
  const map = [];
  for (let k = 0; k < arr.length; k++) {
    const d = displayChar(arr[k].c);
    if (!d) continue;
    text += d;
    map.push(k);
  }
  return { text, map };
}

// The coarse provenance kind used only to decide where to split a sentence.
export function kindOf(r, opts) {
  if (r.unclear || r.pre) return 'pre';
  if (r.srcConf === 'direct' && /^paste/.test(r.src)) return 'paste';
  if (r.batch >= opts.largeInsertion) return 'large';
  return 'typed';
}

function sentenceRanges(text, start, end) {
  const out = [];
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
  for (const s of seg.segment(text.slice(start, end))) {
    out.push([start + s.index, start + s.index + s.segment.length]);
  }
  return out;
}

function trimRange(text, a, b) {
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  return [a, b];
}

// Runs of one kind inside [a, b); runs shorter than MIN_SUBSPAN join a neighbour.
function subspans(kinds, a, b) {
  const runs = [];
  for (let k = a; k < b; k++) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kinds[k]) last.end = k + 1;
    else runs.push({ kind: kinds[k], start: k, end: k + 1 });
  }
  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].end - runs[i].start >= SEGMENT.MIN_SUBSPAN) continue;
      const left = runs[i - 1], right = runs[i + 1];
      const into = !left ? right : !right ? left : (left.end - left.start >= right.end - right.start ? left : right);
      into.start = Math.min(into.start, runs[i].start);
      into.end = Math.max(into.end, runs[i].end);
      runs.splice(i, 1);
      changed = true;
      break;
    }
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].kind === runs[i - 1].kind) {
        runs[i - 1].end = runs[i].end;
        runs.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return runs.map((r) => [r.start, r.end]);
}

// -> { text, map, paragraphs: [{start, end}], spans: [{start, end, para}] }
// Offsets are into the display text.
export function segment(arr, opts) {
  const { text, map } = displayOf(arr);
  const kinds = map.map((k) => kindOf(arr[k], opts));
  const paragraphs = [];
  const spans = [];
  let p = 0;
  while (p <= text.length) {
    let q = text.indexOf('\n', p);
    if (q < 0) q = text.length;
    const para = paragraphs.length;
    paragraphs.push({ start: p, end: q });
    for (const [s0, s1] of sentenceRanges(text, p, q)) {
      const [a, b] = trimRange(text, s0, s1);
      if (b <= a) continue;
      for (const [x, y] of subspans(kinds, a, b)) spans.push({ start: x, end: y, para });
    }
    p = q + 1;
  }
  return { text, map, paragraphs, spans };
}
