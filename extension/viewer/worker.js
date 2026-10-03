// Runs the analysis off the page so a long history never freezes the viewer.
// Keeps the full event list for replay; the page only gets the compact model.

import { analyze } from '../lib/analyze.js';
import { Replayer } from '../lib/replay.js';

let replayer = null;

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'analyze') {
      const t0 = performance.now();
      const result = analyze(e.data.input);
      // "As of" and checkpoint views are prefixes of the full history, so the
      // full history's replayer keeps serving them.
      if (!e.data.light || !replayer) replayer = new Replayer(result._events);
      delete result._events;
      result.diagnostics.analysisMs = Math.round(performance.now() - t0);
      // The dashboard keeps dozens of these; it never replays or inspects edits.
      if (e.data.slim) { result.events = []; result.timeline = { sessions: [], large: [], removals: [] }; }
      self.postMessage({ id, ok: true, result });
    } else if (type === 'replay') {
      if (!replayer) throw new Error('NO_ANALYSIS');
      self.postMessage({ id, ok: true, result: replayer.window(e.data.tab, e.data.events) });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, code: err && err.code ? err.code : 'ANALYSIS_FAILED', message: String(err && err.message) });
  }
};
