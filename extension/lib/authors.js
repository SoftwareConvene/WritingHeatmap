// Who each character belongs to. Text that was already in the document when
// its history begins is "provided"; text added by an editor the teacher has
// marked as Teacher (or as Provided) is set aside the same way. Only student
// text gets a process color, because what matters is what the student did.

import { OP, SOURCE } from './events.js';
import { timing } from './metrics.js';
import { isBlank as isSpace } from './gdocs/kixtext.js';

export const ROLE = Object.freeze({ STUDENT: 'student', TEACHER: 'teacher', PROVIDED: 'provided' });
export const OWNER_PROVIDED = 'provided';
export const OWNER_TEACHER = 'teacher';

export function isStudentOwner(owner) {
  return typeof owner === 'string' && owner.startsWith('student:');
}

// roles: { actorId: ROLE }. Unlisted editors are students.
export function ownerFn(roles = {}) {
  return (r) => {
    if (r.pre) return OWNER_PROVIDED;
    const role = roles[r.actor];
    if (role === ROLE.TEACHER) return OWNER_TEACHER;
    if (role === ROLE.PROVIDED) return OWNER_PROVIDED;
    return `student:${r.actor}`;
  };
}


// recs: every char record across tabs. spans: classified spans with .owner.
// largeInsertion: the size at which one insertion counts as "added in a
// large chunk" rather than typed (classify.js THRESHOLDS).
// whenOf(t) -> 'school' | 'home' | 'late' (when.js), for the school/home split.
export function contributions({ recs, events, actors, spans, roles, removedProvided, largeInsertion = 80, whenOf = null, internal = new Set() }) {
  const owner = ownerFn(roles);
  const finalChars = new Map();
  const words = new Map();
  const finalWhen = new Map(); // owner -> { school, home, late } characters of final text
  let prevOwner = null, prevSpace = true, total = 0;
  for (const r of recs) {
    const space = isSpace(r.c);
    const o = owner(r);
    if (!space) {
      total++;
      finalChars.set(o, (finalChars.get(o) || 0) + 1);
      if (whenOf && r.t != null) {
        const w = whenOf(r.t);
        if (!finalWhen.has(o)) finalWhen.set(o, { school: 0, home: 0, late: 0 });
        finalWhen.get(o)[w]++;
      }
      if (prevSpace || o !== prevOwner) words.set(o, (words.get(o) || 0) + 1);
    }
    prevSpace = space;
    prevOwner = o;
  }

  const byActor = new Map(actors.map((a) => [a.id, { inserted: 0, typed: 0, chunked: 0, chunks: 0, copied: 0, copies: 0, deleted: 0, events: [], when: { school: 0, home: 0, late: 0 } }]));
  for (const e of events) {
    const a = byActor.get(e.actor);
    if (!a || e.t == null) continue;
    if (e.op === OP.INS || e.op === OP.SUGINS) {
      a.inserted += e.text.length;
      // Text copied or moved from elsewhere in the document (a draft pasted
      // into the final section) is counted on its own, not as a large chunk.
      // The template a Doc started from is set aside, not counted as a chunk.
      if (e.source === SOURCE.HISTORY_START) { /* the starting template */ } else if (internal.has(e.i)) { a.copied += e.text.length; a.copies++; }
      else if (e.text.length >= largeInsertion) { a.chunked += e.text.length; a.chunks++; } else a.typed += e.text.length;
      if (whenOf) a.when[whenOf(e.t)] += e.text.length;
      a.events.push(e);
    }
    else if (e.op === OP.DEL || e.op === OP.SUGDEL) { a.deleted += e.len; a.events.push(e); }
  }

  // A writer's final text by how it was written: share of characters, and words.
  const catsFor = (o) => {
    const c = {}, w = {};
    let n = 0;
    let copiedWords = 0, retypedWords = 0;
    for (const s of spans) {
      if (s.owner !== o) continue;
      c[s.cat] = (c[s.cat] || 0) + s.m.n;
      w[s.cat] = (w[s.cat] || 0) + (s.words || 0);
      n += s.m.n;
      if ((s.badges || []).includes('moved')) copiedWords += s.words || 0;
      if ((s.badges || []).includes('retyped')) retypedWords += s.words || 0;
    }
    for (const k of Object.keys(c)) c[k] /= n || 1;
    return { shares: c, words: w, copiedWords, retypedWords };
  };

  const rows = actors.map((a) => {
    const role = roles[a.id] || ROLE.STUDENT;
    const o = role === ROLE.TEACHER ? OWNER_TEACHER : role === ROLE.PROVIDED ? OWNER_PROVIDED : `student:${a.id}`;
    const act = byActor.get(a.id);
    const t = timing(act.events);
    const mine = role === ROLE.STUDENT;
    // Each writing session with how much went in, and when large chunks
    // arrived: the side panel's timeline strip.
    const sessionList = t.sessions.slice(0, 300).map((x) => ({ start: x.start, end: x.end, typed: 0, chunked: 0 }));
    const chunkTimes = [];
    let si = 0;
    for (const e of act.events) {
      if (e.op !== OP.INS && e.op !== OP.SUGINS) continue;
      while (si + 1 < sessionList.length && e.t >= sessionList[si + 1].start) si++;
      const big = e.text.length >= largeInsertion && !internal.has(e.i) && e.source !== SOURCE.HISTORY_START;
      if (sessionList[si]) sessionList[si][big ? 'chunked' : 'typed'] += e.text.length;
      if (big && chunkTimes.length < 100) chunkTimes.push([e.t, e.text.length]);
    }
    return {
      id: a.id,
      role,
      owner: o,
      // Teacher and provided editors share one bucket, so their final share is
      // reported on the bucket row, not per person.
      finalChars: mine ? finalChars.get(o) || 0 : null,
      share: mine && total ? (finalChars.get(o) || 0) / total : null,
      words: mine ? words.get(o) || 0 : null,
      inserted: act.inserted,
      typed: act.typed,           // characters entered in ordinary typing-sized batches
      chunked: act.chunked,       // characters that arrived 80+ at a time
      chunks: act.chunks,
      copied: act.copied,         // characters copied or moved from elsewhere in the document
      copies: act.copies,
      deleted: act.deleted,
      insertedWhen: act.when,     // characters put in during school / at home / after the due date
      finalWhen: mine ? finalWhen.get(o) || { school: 0, home: 0, late: 0 } : null,
      removedProvided: removedProvided[a.id] || 0,
      activeMs: t.activeMs,
      sessions: t.sessions.length,
      sessionList,
      chunkTimes,
      firstT: t.firstT,
      lastT: t.lastT,
      ...(mine ? (({ shares, words: cw, copiedWords, retypedWords }) => ({ cats: shares, catWords: cw, copiedWords, retypedWords }))(catsFor(o)) : { cats: {}, catWords: {}, copiedWords: 0, retypedWords: 0 }),
    };
  });

  const bucket = (o) => ({ owner: o, finalChars: finalChars.get(o) || 0, share: total ? (finalChars.get(o) || 0) / total : 0, words: words.get(o) || 0 });
  const studentChars = [...finalChars.entries()].filter(([o]) => isStudentOwner(o)).reduce((s, [, n]) => s + n, 0);
  const studentWhen = { school: 0, home: 0, late: 0 };
  for (const [o, w] of finalWhen) if (isStudentOwner(o)) for (const k of Object.keys(w)) studentWhen[k] += w[k];
  return {
    total,
    studentWhen,
    studentChars,
    studentShare: total ? studentChars / total : 0,
    provided: bucket(OWNER_PROVIDED),
    teacher: bucket(OWNER_TEACHER),
    editors: rows,
  };
}
