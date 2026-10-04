// Replay: the edits around one passage or section, or the whole document.
// Works on plain strings with checkpoints so jumping into a long history
// does not replay everything from the start each time.

import { OP } from './events.js';

export const REPLAY = Object.freeze({
  BEFORE_EVENTS: 15, BEFORE_MS: 20 * 1000, AFTER_EVENTS: 15, LEAD_GAP_MS: 2 * 60 * 1000, CHECKPOINT: 500, MAX_STEPS: 3000,
  MAX_STEPS_LONG: 400_000, // a section or the whole document
});

// [[first, last], …] runs of event numbers -> the numbers.
export function expandRuns(runs) {
  const out = [];
  for (const [a, b] of runs || []) for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function stepOf(e, relevant) {
  return { i: e.i, t: e.t, actor: e.actor, op: e.op, pos: e.pos, len: e.len, text: e.text, relevant };
}

const CHANGES = new Set([OP.INS, OP.SUGINS, OP.DEL, OP.SUGDEL, OP.RESET]);

export function applyToText(text, e) {
  switch (e.op) {
    case OP.INS: case OP.SUGINS: {
      const p = Math.max(0, Math.min(e.pos, text.length));
      return text.slice(0, p) + e.text + text.slice(p);
    }
    case OP.DEL: case OP.SUGDEL:
      if (e.pos < 0 || e.pos >= text.length) return text;
      return text.slice(0, e.pos) + text.slice(e.pos + e.len);
    case OP.RESET:
      return e.text;
    default:
      return text;
  }
}

export class Replayer {
  constructor(events) {
    this.events = events;
    this.byTab = new Map(); // tab -> { idx: [event indices], checkpoints: [{k, text}] }
  }

  tab(tab) {
    let t = this.byTab.get(tab);
    if (t) return t;
    const idx = this.events.filter((e) => e.tab === tab && CHANGES.has(e.op)).map((e) => e.i);
    const checkpoints = [{ k: 0, text: '' }];
    let text = '';
    idx.forEach((i, k) => {
      if (k > 0 && k % REPLAY.CHECKPOINT === 0) checkpoints.push({ k, text });
      text = applyToText(text, this.events[i]);
    });
    t = { idx, checkpoints };
    this.byTab.set(tab, t);
    return t;
  }

  // Text of `tab` before its k-th change.
  textBefore(tab, k) {
    const t = this.tab(tab);
    let cp = t.checkpoints[0];
    for (const c of t.checkpoints) if (c.k <= k) cp = c; else break;
    let text = cp.text;
    for (let j = cp.k; j < k; j++) text = applyToText(text, this.events[t.idx[j]]);
    return text;
  }

  // Every change to `tab`, from an empty page.
  full(tab, maxSteps = REPLAY.MAX_STEPS_LONG) {
    const t = this.tab(tab);
    const end = Math.min(t.idx.length, maxSteps);
    const steps = [];
    for (let k = 0; k < end; k++) steps.push(stepOf(this.events[t.idx[k]], false));
    return { windows: steps.length ? [{ startText: '', steps }] : [], truncated: end < t.idx.length };
  }

  // relevant: event indices behind a passage or section.
  // -> { windows: [{ startText, steps }] }
  window(tab, relevant, maxSteps = REPLAY.MAX_STEPS) {
    const rel = new Set(relevant);
    const t = this.tab(tab);
    const pos = new Map(t.idx.map((i, k) => [i, k]));
    const ks = [...rel].map((i) => pos.get(i)).filter((k) => k !== undefined).sort((a, b) => a - b);
    if (!ks.length) return { windows: [] };
    const ranges = [];
    const tOf = (k) => this.events[t.idx[k]].t;
    const near = (k, j) => tOf(k) == null || tOf(j) == null || Math.abs(tOf(k) - tOf(j)) <= REPLAY.LEAD_GAP_MS;
    for (const k of ks) {
      // Lead-in: up to 15 edits, or all edits in the 20 seconds before, but
      // never reaching back across a pause into unrelated earlier work.
      let a = k;
      while (a > 0 && near(k, a - 1) && (k - a < REPLAY.BEFORE_EVENTS || (tOf(k) != null && tOf(k) - tOf(a - 1) <= REPLAY.BEFORE_MS))) a--;
      let b = k + 1;
      while (b < t.idx.length && b - k <= REPLAY.AFTER_EVENTS && near(k, b)) b++;
      const last = ranges[ranges.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else ranges.push([a, b]);
    }
    let budget = maxSteps;
    const windows = [];
    for (const [a, b] of ranges) {
      if (budget <= 0) break;
      const end = Math.min(b, a + budget);
      budget -= end - a;
      const steps = [];
      for (let k = a; k < end; k++) {
        const e = this.events[t.idx[k]];
        steps.push(stepOf(e, rel.has(e.i)));
      }
      windows.push({ startText: this.textBefore(tab, a), steps });
    }
    return { windows, truncated: budget <= 0 };
  }
}
