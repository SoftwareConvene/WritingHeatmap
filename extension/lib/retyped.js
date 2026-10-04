// Text pasted in, rewritten next to itself, then deleted. Once the paste is
// gone only the rewrite is left, typed a few characters at a time, so on its
// own it looks written in place. It is found by its timing (typed by the same
// writer while their paste was still in the Doc, or just after it went) and
// by the words it shares with the deleted paste.

import { OP } from './events.js';

export const RETYPED = Object.freeze({
  goneShare: 0.6,          // at least this much of the paste was deleted
  afterMs: 10 * 60 * 1000, // typing this long after the paste went still counts
  typedShare: 0.5,         // of the passage's typed characters, inside that window
  minTyped: 15,            // characters typed in the passage
  minWords: 3,             // content words in the sentence
  minShared: 2,            // content words shared with the paste
  sharedShare: 0.25,       // ...as a share of the sentence's content words
  keepText: 1500,          // characters of the deleted paste kept for the viewer
});

const STOP = new Set(('about above after again against also among and another any are around because been before being below between both '
  + 'but can could did does doing down during each even every few for from further had has have having her here hers him his how into its '
  + 'just like made make many more most much must not now off once only other our out over own same she should since some such than that '
  + 'the their them then there these they this those through too under until upon very was were what when where which while who whom why '
  + 'will with within without would you your').split(' '));

// A rough stem, so "plants" and "plant", "converted" and "converts" meet.
function stem(w) {
  return w.replace(/(ing|ed|es|s|ly)$/, '');
}

export function contentWords(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (w.length < 4 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

// The deleted paste split into pieces, with the words it shares with the
// passage now marked. -> [{ text, shared }]
export function sharedPieces(paste, now) {
  const mine = contentWords(now);
  return String(paste).split(/([\p{L}\p{N}]+)/u).filter(Boolean).map((piece) => {
    const w = piece.toLowerCase();
    return { text: piece, shared: w.length >= 4 && !STOP.has(w) && mine.has(stem(w)) };
  });
}

// Pastes that were mostly deleted again. finals: every tab's final records;
// isStudent(actorId). -> [{ ev, words }]
export function deletedPastes({ events, finals, goneAt, internal, large, isStudent }) {
  const left = new Map();
  for (const arr of finals) for (const r of arr) if (!r.pre) left.set(r.ev, (left.get(r.ev) || 0) + 1);
  const out = [];
  for (const e of events) {
    if (e.op !== OP.INS || e.t == null || e.text.length < large || internal.has(e.i) || !isStudent(e.actor)) continue;
    if (!goneAt.has(e.i) || (left.get(e.i) || 0) > e.text.length * (1 - RETYPED.goneShare)) continue;
    const words = contentWords(e.text);
    if (words.size >= RETYPED.minShared) out.push({ ev: e, gone: goneAt.get(e.i), words });
  }
  return out;
}

// One passage: recs are its characters, sentence the whole sentence it is in.
// -> { text, t, goneT, shared, of } | null
export function retypedMatch(recs, sentence, pastes, large) {
  if (!pastes.length) return null;
  const typed = recs.filter((r) => !r.pre && r.t != null && r.batch < large && r.moved < 0 && !/\s/.test(r.c));
  if (typed.length < RETYPED.minTyped) return null;
  const words = contentWords(sentence);
  if (words.size < RETYPED.minWords) return null;
  let best = null;
  for (const p of pastes) {
    const inWindow = typed.filter((r) => r.actor === p.ev.actor && r.t >= p.ev.t && r.t <= p.gone + RETYPED.afterMs).length;
    if (inWindow < typed.length * RETYPED.typedShare) continue;
    let shared = 0;
    for (const w of words) if (p.words.has(w)) shared++;
    if (shared < RETYPED.minShared || shared < words.size * RETYPED.sharedShare) continue;
    if (!best || shared / words.size > best.shared / best.of) {
      best = { ev: p.ev.i, text: p.ev.text.slice(0, RETYPED.keepText), cut: p.ev.text.length > RETYPED.keepText, t: p.ev.t, goneT: p.gone, shared, of: words.size };
    }
  }
  return best;
}
