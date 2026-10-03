// Google commands -> EditEvents (lib/events.js). This is the only file that
// knows what `is`, `ds` and friends mean.

import { OP, SOURCE, CONF, makeEvent } from '../events.js';
import { flatten, snapshotCommands } from './parse.js';

// Styling and structure commands that never change the text.
const FORMAT_TYPES = new Set(['as', 'ae', 'te', 'ue', 'de', 'mkch', 'ac', 'umv', 'null', 'sl', 'uefs', 'asfs', 'ase', 'use']);

// No reader has found a paste marker in Google's history. If Phase 0 finds
// one, detect it here and set source + srcConf DIRECT; the classifier's
// "Pasted" category switches on by itself through capabilities.pasteMarker.
export function pasteMarkerOf(/* cmd, entry */) {
  return null;
}

// Whether `ds` ranges include their end index. Two readers say yes, one says
// no; analyze() tries both against Google's own copy of the text and keeps the
// one that matches.
export const DEFAULT_OPTS = { deleteInclusive: true };

function range(cmd, inclusive) {
  const si = Number(cmd.si), ei = Number(cmd.ei);
  if (!Number.isFinite(si) || !Number.isFinite(ei)) return null;
  const len = inclusive ? ei - si + 1 : ei - si;
  return len > 0 ? { pos: si - 1, len } : null;
}

function insertAt(cmd) {
  const ibi = Number(cmd.ibi);
  if (!Number.isFinite(ibi) || typeof cmd.s !== 'string') return null;
  return { pos: ibi - 1, text: cmd.s };
}

// Text of a replace-all (rplc) or snapshot: replay its inserts onto empty text.
export function textOfCommands(cmds, opts = DEFAULT_OPTS) {
  const byTab = new Map();
  for (const c of cmds) {
    flatten(c, '', (leaf, tab) => {
      let s = byTab.get(tab) ?? '';
      if (leaf.ty === 'is' || leaf.ty === 'iss') {
        const ins = insertAt(leaf);
        if (ins) s = s.slice(0, ins.pos) + ins.text + s.slice(ins.pos);
      } else if (leaf.ty === 'ds' || leaf.ty === 'dss') {
        const r = range(leaf, opts.deleteInclusive);
        if (r) s = s.slice(0, r.pos) + s.slice(r.pos + r.len);
      }
      byTab.set(tab, s);
    });
  }
  return byTab;
}

function leafEvent(leaf, tab, entry, opts) {
  const base = {
    t: entry.t, actor: entry.actor, rev: entry.rev ?? 0, group: entry.idx, tab, cmd: String(leaf.ty ?? '?'),
  };
  switch (leaf.ty) {
    case 'is': case 'iss': {
      const ins = insertAt(leaf);
      if (!ins) return makeEvent({ ...base, op: OP.UNKNOWN });
      const marker = pasteMarkerOf(leaf, entry);
      return makeEvent({
        ...base, ...ins,
        op: leaf.ty === 'iss' ? OP.SUGINS : OP.INS,
        sug: leaf.ty === 'iss' ? String(leaf.sugid ?? '') : null,
        source: marker ?? SOURCE.UNKNOWN,
        srcConf: marker ? CONF.DIRECT : CONF.UNKNOWN,
      });
    }
    case 'ds': case 'dss': {
      const r = range(leaf, opts.deleteInclusive);
      if (!r) return makeEvent({ ...base, op: OP.UNKNOWN });
      return makeEvent({ ...base, ...r, op: leaf.ty === 'dss' ? OP.SUGDEL : OP.DEL, sug: leaf.sugid ? String(leaf.sugid) : null });
    }
    case 'msfd': case 'usfd': {
      const r = range(leaf, opts.deleteInclusive);
      if (!r) return makeEvent({ ...base, op: OP.OTHER });
      return makeEvent({ ...base, ...r, op: leaf.ty === 'msfd' ? OP.MARK : OP.UNMARK, sug: String(leaf.sugid ?? '') });
    }
    case 'rplc': {
      const snap = leaf.snapshot ?? leaf.s ?? [];
      const texts = textOfCommands(Array.isArray(snap) ? snap : [], opts);
      return makeEvent({ ...base, op: OP.RESET, text: texts.get('') ?? '', source: SOURCE.HISTORY_START, srcConf: CONF.INFERRED });
    }
    default:
      return makeEvent({ ...base, op: FORMAT_TYPES.has(leaf.ty) ? OP.FMT : OP.UNKNOWN });
  }
}

// Commands outside any tab wrapper belong to the first tab, which wrapped
// commands call t.0; both mean the same text.
function mainTab(tab) {
  return tab === 't.0' ? '' : tab;
}

// entries + first-page snapshot -> EditEvent[]. Snapshot text comes first as
// insertions with t = null: it was there before the history we can see.
export function normalize({ entries, snapshot }, opts = DEFAULT_OPTS) {
  const events = [];
  const push = (ev) => { ev.i = events.length; events.push(ev); };
  const snapTexts = textOfCommands(snapshotCommands(snapshot), opts);
  for (const [rawTab, text] of snapTexts) {
    const tab = mainTab(rawTab);
    if (text) {
      push(makeEvent({
        t: null, op: OP.INS, pos: 0, text, tab, group: -1, cmd: 'snapshot',
        source: SOURCE.HISTORY_START, srcConf: CONF.DIRECT,
      }));
    }
  }
  for (const entry of entries) {
    flatten(entry.cmd, '', (leaf, tab) => push(leafEvent(leaf, mainTab(tab), entry, opts)));
  }
  return events;
}
