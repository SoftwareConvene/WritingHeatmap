// Time each student spent editing each section. Counted the same way as
// "Time spent writing" for the whole document: the gaps between one
// student's edits, leaving out gaps over two minutes. Each gap goes to the
// section the later edit is in; an edit whose text is gone counts toward the
// section that student was last working in. Reading, research and thinking
// with no typing are never seen, and text written elsewhere and pasted in
// takes almost no time here.

import { OP } from './events.js';
import { TIMING } from './metrics.js';

const TEXT_OPS = new Set([OP.INS, OP.DEL, OP.SUGINS, OP.SUGDEL]);

// tabs: [{ spans, sections }]; each section gets activeMs = { owner: ms }.
// events: the analysis's events, in order. ownerOf(actorId): the owner key
// of a student ('student:<id>'), or null for anyone else.
export function sectionTimes(tabs, events, ownerOf) {
  const where = new Map(); // event index -> the sections its text is in
  for (const tab of tabs) {
    for (const sec of tab.sections || []) {
      sec.activeMs = {};
      for (const sp of tab.spans) {
        if (sp.para < sec.para || sp.para >= sec.endPara) continue;
        for (const [a, b] of sp.runs || []) {
          for (let i = a; i <= b; i++) {
            const list = where.get(i);
            if (!list) where.set(i, [sec]);
            else if (!list.includes(sec)) list.push(sec);
          }
        }
      }
    }
  }
  const last = new Map(); // actor -> { t, secs }
  events.forEach((e, i) => {
    if (e.t == null || !TEXT_OPS.has(e.op)) return;
    const owner = ownerOf(e.actor);
    if (!owner) return;
    const prev = last.get(e.actor);
    const secs = where.get(i) || (prev && prev.secs) || null;
    if (prev && secs) {
      const gap = e.t - prev.t;
      if (gap > 0 && gap <= TIMING.ACTIVE_GAP_MS) for (const s of secs) s.activeMs[owner] = (s.activeMs[owner] || 0) + gap;
    }
    last.set(e.actor, { t: e.t, secs });
  });
}
