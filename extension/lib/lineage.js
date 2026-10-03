// Replays EditEvents into one record per surviving character, so every
// character in the finished text knows how it got there. This is "blame for
// the writing process": the heatmap classifies these records, never the raw
// chronological events.

import { OP, SOURCE, CONF } from './events.js';

export const LINEAGE = Object.freeze({
  FRONTIER_TOLERANCE: 20, // research §4.4: chars allowed after the cursor and still "writing in place"
  POST_CONTEXT_ADVANCE: 100, // research §4.4: later text before an edit counts as "going back"
  MOVE_MIN: 20,           // shortest insertion checked for being moved or copied text
  LARGE_REMOVAL: 200,     // one deletion this big, not replaced, is a removal, not revision
  SESSION_GAP_MS: 30 * 60 * 1000,
});

// A char record. `rev` and `post` are deletion credit (fractional) that the
// metrics add to the passage this character ends up in.
function charRec(c, ev, over) {
  return {
    c,
    ev: ev.i,            // event that first produced the character (kept through moves)
    t: ev.t,
    actor: ev.actor,
    batch: ev.text.length, // size of that first insertion
    frontier: true,      // first produced at the end of its paragraph
    pre: ev.t == null || ev.source === SOURCE.HISTORY_START,
    src: ev.source,
    srcConf: ev.srcConf,
    sug: ev.sug,
    marked: false,
    moved: -1,           // event that moved or copied it here, or -1
    revIns: false,       // inserted into existing text: a revision
    postIns: false,      // ...after the writer had moved well past this spot
    rev: 0,
    post: 0,
    repl: -1,            // replacement this character took part in
    removedNear: 0,      // big removal next to it (not revision)
    cred: null,          // events whose deletions were credited here
    ...over,
  };
}

function insertChars(arr, pos, recs) {
  if (recs.length < 5000) { arr.splice(pos, 0, ...recs); return arr; }
  return arr.slice(0, pos).concat(recs, arr.slice(pos));
}

// Characters after `pos` up to the paragraph end, stopping once over the limit.
function tailInParagraph(arr, pos, limit) {
  let n = 0;
  for (let k = pos; k < arr.length; k++) {
    if (arr[k].c === '\n') break;
    if (++n > limit) break;
  }
  return n;
}

// Has the writer produced POST_CONTEXT_ADVANCE characters after `pos` since
// the text just before `pos` was written?
function isPostContext(arr, pos) {
  const anchor = pos > 0 ? arr[pos - 1] : null;
  const tRef = anchor && anchor.t != null ? anchor.t : -Infinity;
  let n = 0;
  for (let k = pos; k < arr.length; k++) {
    const r = arr[k];
    if (r.t != null && r.t > tRef && ++n >= LINEAGE.POST_CONTEXT_ADVANCE) return true;
  }
  return false;
}

function addCredit(rec, amount, post, events) {
  rec.rev += amount;
  rec.post += post;
  if (events.length) {
    rec.cred ||= [];
    for (const e of events) if (!rec.cred.includes(e) && rec.cred.length < 50) rec.cred.push(e);
  }
}

export function buildLineage(events) {
  const tabs = new Map();
  const stats = { outOfRange: 0, unknown: 0, resets: 0, lostCredit: 0, moves: 0, copies: 0, replacements: 0 };
  const largeRemovals = [];
  const replacements = new Map(); // repl id -> chars removed
  const tabArr = (tab) => {
    let a = tabs.get(tab);
    if (!a) { a = []; tabs.set(tab, a); }
    return a;
  };

  // A deletion's credit waits here: if the next insertion lands in the same
  // spot it is a replacement and the new text inherits the credit; otherwise
  // it goes to the character just before the gap.
  let pending = null;

  const lastGroup = events.length ? events[events.length - 1].group : null;
  let beforeLast = null;

  // Cuts that were not pasted straight away, so a paste a little later is
  // still recognised as moved text.
  const recentCuts = [];

  function flush() {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (p.removed >= LINEAGE.MOVE_MIN) {
      recentCuts.push({ tab: p.tab, text: p.text, recs: p.recs });
      if (recentCuts.length > 10) recentCuts.shift();
    }
    const arr = tabArr(p.tab);
    // Credit the word the gap is in: the character before it, unless that is
    // whitespace and a word follows.
    const before = arr[p.pos - 1], after = arr[p.pos];
    const blank = (r) => !r || /\s/.test(r.c);
    const rec = !blank(before) ? before : !blank(after) ? after : (before ?? after);
    if (!rec) { stats.lostCredit += p.credit; return; }
    if (p.removed >= LINEAGE.LARGE_REMOVAL) {
      rec.removedNear += p.removed;
      largeRemovals.push({ i: p.events[0], t: p.t, len: p.removed, tab: p.tab });
      return;
    }
    addCredit(rec, p.credit, p.post, p.events);
  }

  function doDelete(ev, arr) {
    let { pos, len } = ev;
    if (pos < 0 || pos >= arr.length) { stats.outOfRange++; return; }
    if (pos + len > arr.length) { stats.outOfRange++; len = arr.length - pos; }
    // Deleting at a paragraph end is only an in-the-moment correction while
    // that text is fresh; coming back to it in a later session is revision.
    const anchor = arr[pos - 1];
    const fresh = !anchor || anchor.t == null || ev.t == null || ev.t - anchor.t < LINEAGE.SESSION_GAP_MS;
    const atFrontier = fresh && tailInParagraph(arr, pos + len, LINEAGE.FRONTIER_TOLERANCE) <= LINEAGE.FRONTIER_TOLERANCE;
    const post = !atFrontier && isPostContext(arr, pos);
    const removed = arr.splice(pos, len);
    let carried = 0, carriedPost = 0;
    const carriedEvents = [];
    for (const r of removed) {
      carried += r.rev; carriedPost += r.post;
      if (r.cred) carriedEvents.push(...r.cred);
    }
    const text = removed.map((r) => r.c).join('');
    // Backspacing or forward-deleting next to the waiting gap extends it.
    if (pending && pending.tab === ev.tab && (pos + len === pending.pos || pos === pending.pos)) {
      if (pos + len === pending.pos) { // backspace: this text came before the gap
        pending.text = text + pending.text;
        pending.recs = removed.concat(pending.recs);
      } else {                         // forward delete: it came after
        pending.text += text;
        pending.recs = pending.recs.concat(removed);
      }
      pending.pos = pos;
      pending.credit += len + carried;
      pending.post += (post ? len : 0) + carriedPost;
      pending.removed += len;
      pending.events.push(ev.i, ...carriedEvents);
      return;
    }
    flush();
    pending = {
      tab: ev.tab, pos, t: ev.t, text, recs: removed, removed: len,
      credit: len + carried, post: (post ? len : 0) + carriedPost, events: [ev.i, ...carriedEvents],
    };
  }

  function inherit(ev, sourceRecs, kind) {
    return sourceRecs.map((src, k) => ({
      ...src,
      c: ev.text[k],
      moved: ev.i,
      sug: ev.sug,
      marked: false,
      cred: src.cred ? [...src.cred] : null,
      // A copy is new text built from old text; only a move carries the old credit.
      rev: kind === 'move' ? src.rev : 0,
      post: kind === 'move' ? src.post : 0,
      removedNear: 0,
      src: kind === 'copy' && src.srcConf !== CONF.DIRECT ? SOURCE.PASTE_INTERNAL : src.src,
      srcConf: kind === 'copy' && src.srcConf !== CONF.DIRECT ? CONF.INFERRED : src.srcConf,
    }));
  }

  function doInsert(ev, arr) {
    let pos = ev.pos;
    if (pos < 0 || pos > arr.length) { stats.outOfRange++; pos = Math.max(0, Math.min(pos, arr.length)); }
    const text = ev.text;
    if (!text) return arr;

    // Cut then paste: the waiting deletion is the same text.
    if (pending && pending.tab === ev.tab && text.length >= LINEAGE.MOVE_MIN && pending.text === text) {
      const recs = inherit(ev, pending.recs, 'move');
      pending = null;
      stats.moves++;
      return insertChars(arr, pos, recs);
    }
    // Typing into the gap a deletion just left: a replacement.
    let share = null;
    if (pending && pending.tab === ev.tab && pending.pos === pos) {
      share = pending;
      pending = null;
      stats.replacements++;
      replacements.set(share.events[0], share.removed);
    } else {
      flush();
    }
    if (!share && text.length >= LINEAGE.MOVE_MIN) {
      const k = recentCuts.findIndex((c) => c.tab === ev.tab && c.text === text);
      if (k >= 0) {
        const [cut] = recentCuts.splice(k, 1);
        stats.moves++;
        return insertChars(arr, pos, inherit(ev, cut.recs, 'move'));
      }
    }
    // Copy within the document: the same text already exists here.
    if (!share && text.length >= LINEAGE.MOVE_MIN && ev.srcConf !== CONF.DIRECT) {
      const whole = arr.map((r) => r.c).join('');
      const at = whole.indexOf(text);
      if (at >= 0) {
        stats.copies++;
        return insertChars(arr, pos, inherit(ev, arr.slice(at, at + text.length), 'copy'));
      }
    }

    const frontier = tailInParagraph(arr, pos, LINEAGE.FRONTIER_TOLERANCE) <= LINEAGE.FRONTIER_TOLERANCE;
    const pre = ev.t == null || ev.source === SOURCE.HISTORY_START;
    const post = !frontier && !pre && isPostContext(arr, pos);
    const recs = [];
    for (let k = 0; k < text.length; k++) {
      recs.push(charRec(text[k], ev, { frontier, revIns: !frontier && !pre, postIns: post }));
    }
    if (share) {
      const each = share.credit / recs.length, eachPost = share.post / recs.length;
      for (const r of recs) { addCredit(r, each, eachPost, share.events); r.repl = share.events[0]; }
    }
    return insertChars(arr, pos, recs);
  }

  for (const ev of events) {
    if (beforeLast === null && lastGroup !== null && ev.group === lastGroup) {
      beforeLast = new Map([...tabs].map(([k, a]) => [k, a.map((r) => r.c).join('')]));
    }
    let arr = tabArr(ev.tab);
    switch (ev.op) {
      case OP.INS:
      case OP.SUGINS:
        tabs.set(ev.tab, doInsert(ev, arr));
        break;
      case OP.DEL:
        doDelete(ev, arr);
        break;
      case OP.SUGDEL: {
        // Suggestion churn is not the writer revising their own text.
        if (ev.pos >= 0 && ev.pos < arr.length) arr.splice(ev.pos, Math.min(ev.len, arr.length - ev.pos));
        else stats.outOfRange++;
        break;
      }
      case OP.MARK:
      case OP.UNMARK:
        for (let k = ev.pos; k < Math.min(ev.pos + ev.len, arr.length); k++) arr[k].marked = ev.op === OP.MARK;
        break;
      case OP.RESET: {
        flush();
        stats.resets++;
        const recs = [];
        for (let k = 0; k < ev.text.length; k++) recs.push(charRec(ev.text[k], ev, { pre: true }));
        tabs.set(ev.tab, recs);
        break;
      }
      case OP.UNKNOWN:
        stats.unknown++;
        break;
      default:
        break;
    }
  }
  flush();
  return { tabs, stats, largeRemovals, replacements, beforeLast: beforeLast ?? new Map() };
}

export function tabText(arr) {
  return arr.map((r) => r.c).join('');
}
