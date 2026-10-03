// Who each character belongs to. Text that was already in the document when
// its history begins is "provided"; text added by an editor the teacher has
// marked as Teacher (or as Provided) is set aside the same way. Only student
// text gets a process colour, because what matters is what the student did.

import { OP } from './events.js';
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
export function contributions({ recs, events, actors, spans, roles, removedProvided }) {
  const owner = ownerFn(roles);
  const finalChars = new Map();
  const words = new Map();
  let prevOwner = null, prevSpace = true, total = 0;
  for (const r of recs) {
    const space = isSpace(r.c);
    const o = owner(r);
    if (!space) {
      total++;
      finalChars.set(o, (finalChars.get(o) || 0) + 1);
      if (prevSpace || o !== prevOwner) words.set(o, (words.get(o) || 0) + 1);
    }
    prevSpace = space;
    prevOwner = o;
  }

  const byActor = new Map(actors.map((a) => [a.id, { inserted: 0, deleted: 0, events: [] }]));
  for (const e of events) {
    const a = byActor.get(e.actor);
    if (!a || e.t == null) continue;
    if (e.op === OP.INS || e.op === OP.SUGINS) { a.inserted += e.text.length; a.events.push(e); }
    else if (e.op === OP.DEL || e.op === OP.SUGDEL) { a.deleted += e.len; a.events.push(e); }
  }

  const catsFor = (o) => {
    const c = {};
    let n = 0;
    for (const s of spans) if (s.owner === o) { c[s.cat] = (c[s.cat] || 0) + s.m.n; n += s.m.n; }
    for (const k of Object.keys(c)) c[k] /= n || 1;
    return c;
  };

  const rows = actors.map((a) => {
    const role = roles[a.id] || ROLE.STUDENT;
    const o = role === ROLE.TEACHER ? OWNER_TEACHER : role === ROLE.PROVIDED ? OWNER_PROVIDED : `student:${a.id}`;
    const act = byActor.get(a.id);
    const t = timing(act.events);
    const mine = role === ROLE.STUDENT;
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
      deleted: act.deleted,
      removedProvided: removedProvided[a.id] || 0,
      activeMs: t.activeMs,
      sessions: t.sessions.length,
      firstT: t.firstT,
      lastT: t.lastT,
      cats: mine ? catsFor(o) : {},
    };
  });

  const bucket = (o) => ({ owner: o, finalChars: finalChars.get(o) || 0, share: total ? (finalChars.get(o) || 0) / total : 0, words: words.get(o) || 0 });
  const studentChars = [...finalChars.entries()].filter(([o]) => isStudentOwner(o)).reduce((s, [, n]) => s + n, 0);
  return {
    total,
    studentChars,
    studentShare: total ? studentChars / total : 0,
    provided: bucket(OWNER_PROVIDED),
    teacher: bucket(OWNER_TEACHER),
    editors: rows,
  };
}
