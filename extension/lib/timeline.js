// The side panel's writing timeline: when each student wrote, on one shared
// scale from the first edit to the last edit or the due date, whichever is
// later. Positions are fractions 0–1 across the strip.

const DAY = 24 * 60 * 60 * 1000;

// editors: contributions.editors (students). dueAt, checkpoints: optional.
// -> { from, to, days: [x], due: x|null, checkpoints: [{ x, label, t }], rows: Map(owner -> row) }
export function timelineModel(editors, { dueAt = null, checkpoints = [] } = {}) {
  const starts = editors.flatMap((e) => (e.sessionList || []).map((s) => s.start));
  const ends = editors.flatMap((e) => (e.sessionList || []).map((s) => s.end));
  if (!starts.length) return null;
  let from = Math.min(...starts);
  let to = Math.max(...ends, ...(dueAt ? [dueAt] : []), ...checkpoints.map((c) => c.t));
  if (to - from < 60 * 60 * 1000) to = from + 60 * 60 * 1000; // at least an hour wide
  const pad = (to - from) * 0.02;
  from -= pad; to += pad;
  const x = (t) => (t - from) / (to - from);

  const days = [];
  const d0 = new Date(from); d0.setHours(24, 0, 0, 0);
  for (let t = d0.getTime(); t < to && days.length < 400; t += DAY) days.push(x(t));

  const rows = new Map();
  for (const e of editors) {
    const list = e.sessionList || [];
    const blocks = list.map((s) => ({ x0: x(s.start), x1: x(s.end), typed: s.typed, chunked: s.chunked }));
    const chunks = (e.chunkTimes || []).map(([t, n]) => ({ x: x(t), n }));
    const total = list.reduce((a, s) => a + s.typed + s.chunked, 0);
    const dayCount = new Set(list.map((s) => new Date(s.start).toDateString())).size;
    let lastDay = null, late = null;
    if (dueAt && total) {
      const inLastDay = list.filter((s) => s.start <= dueAt && s.start > dueAt - DAY).reduce((a, s) => a + s.typed + s.chunked, 0);
      const after = list.filter((s) => s.start > dueAt).reduce((a, s) => a + s.typed + s.chunked, 0);
      lastDay = inLastDay / total;
      late = after / total;
    }
    rows.set(e.owner, { blocks, chunks, total, dayCount, lastDay, late, lastT: list.length ? list[list.length - 1].end : null });
  }
  return {
    from, to, days,
    due: dueAt ? x(dueAt) : null,
    checkpoints: checkpoints.map((c) => ({ x: x(c.t), label: c.label || '', t: c.t })),
    rows,
  };
}
