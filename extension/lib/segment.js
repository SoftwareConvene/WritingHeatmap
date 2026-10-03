// Splits the finished text into the passages the heatmap colours: sentences
// by default, split further when one sentence holds clearly different
// histories (research §4.3).

import { displayChar, isStructure } from './gdocs/kixtext.js';

export const SEGMENT = Object.freeze({ MIN_SUBSPAN: 20 });

// What a reader sees, plus which char record each visible character is.
// Table markers are kept so the viewer can rebuild tables.
export function displayOf(arr) {
  let text = '';
  const map = [];
  for (let k = 0; k < arr.length; k++) {
    const d = displayChar(arr[k].c, true);
    if (!d) continue;
    text += d;
    map.push(k);
  }
  return { text, map };
}

// The coarse provenance kind used only to decide where to split a sentence.
export function kindOf(r, opts) {
  const owner = opts.ownerOf ? opts.ownerOf(r) : '';
  let k;
  if (r.unclear || r.pre) k = 'pre';
  else if (r.srcConf === 'direct' && /^paste/.test(r.src)) k = 'paste';
  else if (r.batch >= opts.largeInsertion) k = 'large';
  else k = 'typed';
  return `${owner}|${k}`;
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

// Runs of one kind inside [a, b); a run shorter than MIN_SUBSPAN joins its
// longer neighbour. Linear, so a long table cell or an unpunctuated page
// cannot stall the analysis.
function subspans(kinds, a, b) {
  const runs = [];
  for (let k = a; k < b; k++) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kinds[k]) last.end = k + 1;
    else runs.push({ kind: kinds[k], start: k, end: k + 1 });
  }
  const len = (r) => r.end - r.start;
  // A change of writer always splits, however short: a template's
  // "Hypothesis:" must never be coloured as the student's own words.
  const owner = (r) => r.kind.slice(0, r.kind.lastIndexOf('|'));
  const out = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (prev && owner(prev) === owner(r) && (len(r) < SEGMENT.MIN_SUBSPAN || len(prev) < SEGMENT.MIN_SUBSPAN || prev.kind === r.kind)) {
      // Keep the kind of whichever side is longer.
      if (len(r) > len(prev)) prev.kind = r.kind;
      prev.end = r.end;
    } else out.push({ ...r });
  }
  return out.map((r) => [r.start, r.end]);
}

const TS_FIELDS = ['b', 'i', 'u', 'x', 'fs', 'va'];

function styleKey(ts) {
  if (!ts) return '';
  return TS_FIELDS.map((f) => (ts[f] === undefined || ts[f] === false || ts[f] === null ? '' : String(ts[f]))).join('|').replace(/^\|+$/, '');
}

// Formatting runs over the display text: [{ start, end, ts }], plain text omitted.
function styleRuns(arr, map) {
  const runs = [];
  let cur = null;
  map.forEach((k, d) => {
    const ts = arr[k].ts;
    const key = styleKey(ts);
    if (cur && cur.key === key && cur.end === d) { cur.end = d + 1; return; }
    if (cur && cur.key) runs.push({ start: cur.start, end: cur.end, ts: compactTs(cur.ts) });
    cur = { key, ts, start: d, end: d + 1 };
  });
  if (cur && cur.key) runs.push({ start: cur.start, end: cur.end, ts: compactTs(cur.ts) });
  return runs;
}

function compactTs(ts) {
  const out = {};
  for (const f of TS_FIELDS) if (ts[f] !== undefined && ts[f] !== null && ts[f] !== false) out[f] = ts[f];
  return out;
}

// A paragraph's style lives on the character that ends it.
function paraStyle(rec) {
  if (!rec) return null;
  const out = {};
  if (rec.ps) for (const [k, v] of Object.entries(rec.ps)) if (v !== null && v !== undefined) out[k] = v;
  if (rec.ls && rec.ls.id) { out.list = String(rec.ls.id); out.n = Number(rec.ls.n) || 0; }
  return Object.keys(out).length ? out : null;
}

// -> { text, map, paragraphs: [{start, end, ps}], layout, runs, spans: [{start, end, para}] }
// Offsets are into the display text. layout is the reading order: { p: index }
// for a paragraph or { m: marker } for a table boundary.
export function segment(arr, opts) {
  const { text, map } = displayOf(arr);
  const kinds = map.map((k) => kindOf(arr[k], opts));
  const paragraphs = [];
  const layout = [];
  const spans = [];
  const addPara = (start, end, endRec) => {
    const para = paragraphs.length;
    paragraphs.push({ start, end, ps: paraStyle(endRec) });
    layout.push({ p: para });
    for (const [s0, s1] of sentenceRanges(text, start, end)) {
      const [a, b] = trimRange(text, s0, s1);
      if (b <= a) continue;
      for (const [x, y] of subspans(kinds, a, b)) spans.push({ start: x, end: y, para });
    }
  };
  let p = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === '\n') { addPara(p, k, arr[map[k]]); p = k + 1; }
    else if (isStructure(c)) {
      if (k > p) addPara(p, k, arr[map[k - 1]]);
      layout.push({ m: c });
      p = k + 1;
    }
  }
  if (p < text.length || !paragraphs.length) addPara(p, text.length, arr[map[text.length - 1]]);
  return { text, map, paragraphs, layout, runs: styleRuns(arr, map), spans };
}
