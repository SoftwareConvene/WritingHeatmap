// Passage categories and their precedence (research §4.5 and §11, plus rule
// 2b for insertions whose source Google does not record). Every threshold is
// in THRESHOLDS so a change is one edit and one test run.

export const THRESHOLDS = Object.freeze({
  largeInsertion: 80,     // chars in one insertion: the most this cut-off can be
  largeInsertionMin: 15,  // ...and the least (largeInsertionFor)
  typingSample: 30,       // insertions smaller than this show how typing arrives
  typingMargin: 3,        // a large insertion is this many times typing's usual size
  pasteShare: 0.60,       // rule 2 and 2b
  linearPasteMax: 0.10,   // rule 5: also applies to large-insertion share
  lightRevision: 0.10,
  heavyRevision: 0.35,
  lightPost: 0.05,
  heavyPost: 0.20,
  heavyReplacement: 0.40, // one replacement removing this share of the passage
  linearity: 0.90,
  unclearShare: 0.50,
  // badges
  pastedThenEdited: { share: 0.40, revision: 0.30 },
  movedShare: 0.50,
});

export const CAT = Object.freeze({
  UNCLEAR: 'unclear',
  PASTED: 'pasted',
  LARGE: 'large',
  HEAVY: 'heavy',
  LIGHT: 'light',
  LINEAR: 'linear',
  MIXED: 'mixed',
  // Not process categories: text that is not the student's.
  PROVIDED: 'provided',
  TEACHER: 'teacher',
});

export const CAT_ORDER = [CAT.LINEAR, CAT.LIGHT, CAT.HEAVY, CAT.LARGE, CAT.PASTED, CAT.UNCLEAR, CAT.MIXED, CAT.PROVIDED, CAT.TEACHER];
export const STUDENT_CATS = CAT_ORDER.filter((c) => c !== CAT.PROVIDED && c !== CAT.TEACHER);

// caps.pasteMarker: does this history record pastes directly? Until a real
// marker is found it is false and rule 2 cannot fire.
export function classify(m, caps = { pasteMarker: false }, T = THRESHOLDS) {
  let cat;
  if (m.unclearShare > T.unclearShare) cat = CAT.UNCLEAR;
  else if (caps.pasteMarker && m.pasteShare >= T.pasteShare) cat = CAT.PASTED;
  else if (m.largeShare >= T.pasteShare) cat = CAT.LARGE;
  else if (m.revisionLoad >= T.heavyRevision || m.postShare >= T.heavyPost || m.heavyRepl) cat = CAT.HEAVY;
  else if ((m.revisionLoad >= T.lightRevision && m.revisionLoad < T.heavyRevision)
    || (m.postShare >= T.lightPost && m.postShare < T.heavyPost)) cat = CAT.LIGHT;
  else if (m.linearity >= T.linearity && m.pasteShare < T.linearPasteMax && m.largeShare < T.linearPasteMax) cat = CAT.LINEAR;
  else cat = CAT.MIXED;
  return { cat, badges: badges(m, T) };
}

// The size at which one insertion counts as "large" for this Doc. Google
// usually stores typing a character or a few at a time, so a 40-character
// paste stands out; where this Doc's typing arrives in bigger pieces the
// cut-off rises with it. sizes: every timed insertion's length.
export function largeInsertionFor(sizes, T = THRESHOLDS) {
  const small = sizes.filter((n) => n > 0 && n < T.typingSample).sort((a, b) => a - b);
  if (small.length < 20) return T.largeInsertionMin;
  const p90 = small[Math.floor(0.9 * (small.length - 1))];
  return Math.min(T.largeInsertion, Math.max(T.largeInsertionMin, Math.ceil(p90 * T.typingMargin)));
}

// How much a passage was revised, by the same thresholds as the categories.
export function revisionLevel(m, T = THRESHOLDS) {
  if (m.revisionLoad >= T.heavyRevision || m.postShare >= T.heavyPost || m.heavyRepl) return 'heavy';
  if (m.revisionLoad >= T.lightRevision || m.postShare >= T.lightPost) return 'light';
  return null;
}

export function badges(m, T = THRESHOLDS) {
  const out = [];
  const inserted = Math.max(m.pasteShare, m.largeShare);
  if (inserted >= T.pastedThenEdited.share && m.revisionLoad >= T.pastedThenEdited.revision) out.push('insertedThenEdited');
  if (m.movedShare >= T.movedShare) out.push('moved');
  if (m.removedNear > 0) out.push('removedNear');
  if (m.sugShare > 0) out.push('suggestion');
  return out;
}
