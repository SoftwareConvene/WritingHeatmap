// The vendor-neutral edit event. Everything after lib/gdocs/ works on these and
// never sees a Google command name, so a change on Google's side is fixed in
// one adapter instead of across the analysis and the viewer.
//
// EditEvent {
//   i        index in the event list
//   t        epoch milliseconds, or null for text present before the history begins
//   actor    opaque editor id ('' when unknown)
//   op       one of OP
//   pos      0-based position in the tab's text
//   len      characters removed (del, sugdel, mark, unmark)
//   text     characters inserted (ins, sugins, reset)
//   tab      tab id ('' = the main tab)
//   group    events from one saved change share a group (an atomic batch)
//   sug      suggestion id, or null
//   source   one of SOURCE
//   srcConf  one of CONF
//   rev      Google's revision number, for "Save raw history" cross-reference
//   cmd      the raw command type, for diagnostics only
// }

export const OP = Object.freeze({
  INS: 'ins',         // text inserted
  DEL: 'del',         // text removed
  SUGINS: 'sugins',   // suggested insertion (suggestion mode)
  SUGDEL: 'sugdel',   // suggested text removed again
  MARK: 'mark',       // text marked for deletion by a suggestion
  UNMARK: 'unmark',
  RESET: 'reset',     // whole tab replaced (version restore, copy, conversion)
  FMT: 'fmt',         // styling or structure only, no text change
  OTHER: 'other',     // recognised but not analysed
  UNKNOWN: 'unknown', // not recognised at all
});

export const SOURCE = Object.freeze({
  UNKNOWN: 'unknown',
  PASTE_EXTERNAL: 'paste_external',
  PASTE_INTERNAL: 'paste_internal',
  HISTORY_START: 'history_start',
});

export const CONF = Object.freeze({
  DIRECT: 'direct',     // the history itself records it
  INFERRED: 'inferred', // worked out from patterns
  UNKNOWN: 'unknown',
});

export function makeEvent(fields) {
  return {
    i: 0, t: null, actor: '', op: OP.UNKNOWN, pos: 0, len: 0, text: '', tab: '',
    group: 0, sug: null, source: SOURCE.UNKNOWN, srcConf: CONF.UNKNOWN, rev: 0, cmd: '',
    ...fields,
  };
}

export const TEXT_OPS = new Set([OP.INS, OP.DEL, OP.SUGINS, OP.SUGDEL, OP.RESET]);
