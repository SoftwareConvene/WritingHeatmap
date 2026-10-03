// Passage and document measures (research §4.4 and §11). Every number here is
// a description of recorded edits; none of them is a judgement.

import { OP } from './events.js';

export const TIMING = Object.freeze({
  SESSION_GAP_MS: 30 * 60 * 1000, // a new writing session after 30 idle minutes
  ACTIVE_GAP_MS: 2 * 60 * 1000,   // gaps over 2 minutes are not counted as active time
});

function isSpace(c) {
  return c === ' ' || c === '\n' || c === '\t' || c === '\u000b';
}

// recs: the char records of one passage (whitespace included). replacements:
// repl id -> chars removed, from buildLineage.
export function passageMetrics(recs, replacements, opts) {
  const body = recs.filter((r) => !isSpace(r.c));
  const n = Math.max(body.length, 1);
  let paste = 0, large = 0, unclear = 0, rev = 0, revIns = 0, post = 0, postIns = 0;
  let frontier = 0, produced = 0, moved = 0, sug = 0, removedNear = 0;
  let firstT = null, lastT = null;
  const replSeen = new Set();
  let heavyRepl = false;
  for (const r of recs) {
    // Deletion credit can land on a space; it still belongs to this passage.
    rev += r.rev;
    post += r.post;
    removedNear += r.removedNear;
    if (r.repl >= 0 && !replSeen.has(r.repl)) {
      replSeen.add(r.repl);
      if ((replacements.get(r.repl) ?? 0) >= opts.heavyReplacement * n) heavyRepl = true;
    }
  }
  for (const r of body) {
    if (r.srcConf === 'direct' && /^paste/.test(r.src)) paste++;
    if (r.unclear || r.pre) unclear++;
    else {
      produced++;
      if (r.frontier) frontier++;
      if (r.batch >= opts.largeInsertion) large++;
    }
    if (r.revIns && r.moved < 0) revIns++;
    if (r.postIns && r.moved < 0) postIns++;
    if (r.moved >= 0) moved++;
    if (r.sug) sug++;
    if (r.t != null) {
      if (firstT == null || r.t < firstT) firstT = r.t;
      if (lastT == null || r.t > lastT) lastT = r.t;
    }
  }
  return {
    n: body.length,
    pasteShare: paste / n,
    largeShare: large / n,
    unclearShare: unclear / n,
    revisionLoad: (rev + revIns) / n,
    postShare: (post + postIns) / n,
    linearity: produced ? frontier / produced : 0,
    heavyRepl,
    movedShare: moved / n,
    sugShare: sug / n,
    removedNear,
    firstT,
    lastT,
  };
}

// Events behind a passage: what created its characters and what was deleted
// from it. Capped so a long-fought sentence stays readable in the inspector.
export function passageEvents(recs, cap = 200) {
  const set = new Set();
  for (const r of recs) {
    if (r.ev >= 0) set.add(r.ev);
    if (r.moved >= 0) set.add(r.moved);
    if (r.cred) for (const e of r.cred) set.add(e);
  }
  const all = [...set].sort((a, b) => a - b);
  return { events: all.length > cap ? all.slice(0, cap) : all, total: all.length };
}

// Whole-document timing from the text-changing events.
export function timing(events) {
  const times = events
    .filter((e) => e.t != null && (e.op === OP.INS || e.op === OP.DEL || e.op === OP.SUGINS || e.op === OP.SUGDEL || e.op === OP.RESET))
    .map((e) => e.t)
    .sort((a, b) => a - b);
  if (!times.length) return { activeMs: 0, sessions: [], activeDays: 0, firstT: null, lastT: null };
  let activeMs = 0;
  const sessions = [{ start: times[0], end: times[0] }];
  for (let k = 1; k < times.length; k++) {
    const gap = times[k] - times[k - 1];
    if (gap <= TIMING.ACTIVE_GAP_MS) activeMs += gap;
    if (gap >= TIMING.SESSION_GAP_MS) sessions.push({ start: times[k], end: times[k] });
    else sessions[sessions.length - 1].end = times[k];
  }
  const days = new Set(times.map((t) => new Date(t).toDateString()));
  return { activeMs, sessions, activeDays: days.size, firstT: times[0], lastT: times[times.length - 1] };
}

// Per-minute activity inside each session, for the timeline strip.
export function activity(events, sessions) {
  const BUCKET = 60 * 1000;
  return sessions.map((s) => {
    const nb = Math.max(1, Math.ceil((s.end - s.start + 1) / BUCKET));
    const ins = new Array(nb).fill(0), del = new Array(nb).fill(0);
    for (const e of events) {
      if (e.t == null || e.t < s.start || e.t > s.end) continue;
      const b = Math.min(nb - 1, Math.floor((e.t - s.start) / BUCKET));
      if (e.op === OP.INS || e.op === OP.SUGINS) ins[b] += e.text.length;
      else if (e.op === OP.DEL || e.op === OP.SUGDEL) del[b] += e.len;
    }
    return { start: s.start, end: s.end, ins, del };
  });
}
