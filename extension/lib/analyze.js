// The whole analysis, from raw history pages to the model the viewer draws.
// Pure: no chrome.*, no fetch, no DOM. The viewer runs it in a worker and the
// tests run it in Node.

import { parsePages, parseBody, diagnostics, snapshotCommands } from './gdocs/parse.js';
import { normalize, textOfCommands } from './gdocs/normalize.js';
import { displayText } from './gdocs/kixtext.js';
import { buildLineage } from './lineage.js';
import { segment } from './segment.js';
import { compareText } from './compare.js';
import { passageMetrics, passageEvents, timing, activity } from './metrics.js';
import { classify, THRESHOLDS, CAT } from './classify.js';
import { OP, TEXT_OPS } from './events.js';

export const ANALYSIS_VERSION = 1;

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function paragraphsOf(arr) {
  const seg = segment(arr, THRESHOLDS);
  return { seg, paras: seg.paragraphs.map((p) => seg.text.slice(p.start, p.end)) };
}

// Google's own copy of the text: the export if we have it, otherwise the
// snapshot that a revisions/load request for the last revision carries.
function referenceTexts(input) {
  if (typeof input.exportText === 'string') return { kind: 'export', texts: [input.exportText] };
  if (input.snapshotBody) {
    try {
      const json = parseBody(input.snapshotBody);
      const t = textOfCommands(snapshotCommands(json.chunkedSnapshot)).get('') ?? '';
      return { kind: 'snapshot', texts: [displayText(t)] };
    } catch { /* fall through */ }
  }
  return { kind: 'none', texts: [] };
}

function attempt(parsed, opts, ref) {
  const events = normalize(parsed, opts);
  const lin = buildLineage(events);
  const main = lin.tabs.get('') ?? [];
  let best = compareText([], null);
  let matchedState = null;
  if (ref.kind !== 'none') {
    const { paras } = paragraphsOf(main);
    best = compareText(paras, ref.texts[0]);
    matchedState = 'end';
    // The snapshot may describe the text before or after the last revision.
    if (ref.kind === 'snapshot' && best.status !== 'exact' && lin.beforeLast.has('')) {
      const alt = compareText(displayText(lin.beforeLast.get('')).split('\n'), ref.texts[0]);
      if (alt.status === 'exact') {
        best = { status: 'exact', ratio: 1, mismatched: new Set() };
        matchedState = 'beforeLast';
      }
    }
  }
  return { opts, events, lin, cmp: best, matchedState };
}

function actorTable(events, userMap) {
  const order = [];
  for (const e of events) if (e.t != null && e.actor && !order.includes(e.actor)) order.push(e.actor);
  return order.map((id, k) => {
    const u = userMap && userMap[id];
    const name = u && typeof u === 'object' && typeof u.name === 'string' ? u.name : '';
    return { id, label: `Editor ${k + 1}`, name };
  });
}

function readTiles(tilesBody) {
  if (!tilesBody) return null;
  try {
    const j = parseBody(tilesBody);
    const tiles = Array.isArray(j.tileInfo) ? j.tileInfo : [];
    return { lastRev: tiles.length ? tiles[tiles.length - 1].end : null, firstRev: j.firstRev ?? null, userMap: j.userMap ?? null };
  } catch { return null; }
}

export function analyze(input) {
  const caps = { pasteMarker: false, ...(input.capabilities || {}) };
  const parsed = parsePages(input.pages || []);
  const diag = diagnostics(parsed.entries);
  const ref = referenceTexts(input);
  const tiles = readTiles(input.tilesBody);

  // Try both readings of delete ranges; keep the one Google's text agrees with.
  const tries = [attempt(parsed, { deleteInclusive: true }, ref), attempt(parsed, { deleteInclusive: false }, ref)];
  const score = (a) => [a.cmp.ratio ?? -1, -a.lin.stats.outOfRange];
  tries.sort((a, b) => {
    const [ra, oa] = score(a), [rb, ob] = score(b);
    return rb - ra || ob - oa;
  });
  const chosen = tries[0];
  const { events, lin } = chosen;

  // History-start content and mismatched paragraphs become "unclear".
  let cmp = chosen.cmp;
  const tabsOut = [];
  const allRecs = [];
  for (const [tabId, arr] of lin.tabs) {
    if (tabId === '' && cmp.mismatched.size) {
      const first = segment(arr, THRESHOLDS);
      first.paragraphs.forEach((p, idx) => {
        if (!cmp.mismatched.has(idx)) return;
        for (let d = p.start; d < p.end; d++) arr[first.map[d]].unclear = true;
      });
    }
    const seg = segment(arr, THRESHOLDS);
    const spans = seg.spans.map((s, k) => {
      const recs = [];
      for (let d = s.start; d < s.end; d++) recs.push(arr[seg.map[d]]);
      // Deletion credit sits on the character before a gap, which may be a
      // space just outside the trimmed passage; pull in trailing whitespace.
      for (let d = s.end; d < seg.text.length && /\s/.test(seg.text[d]) && seg.text[d] !== '\n'; d++) recs.push(arr[seg.map[d]]);
      const m = passageMetrics(recs, lin.replacements, THRESHOLDS);
      const { cat, badges } = classify(m, caps);
      const ev = passageEvents(recs);
      return { id: `${tabId || 'main'}:${k}`, tab: tabId, start: s.start, end: s.end, para: s.para, cat, badges, m, events: ev.events, eventsTotal: ev.total };
    });
    allRecs.push(...arr);
    tabsOut.push({ id: tabId, text: seg.text, paragraphs: seg.paragraphs, spans });
  }
  tabsOut.sort((a, b) => (a.id === '' ? -1 : b.id === '' ? 1 : a.id.localeCompare(b.id)));

  const time = timing(events);
  const actors = actorTable(events, tiles && tiles.userMap);
  const actorIndex = new Map(actors.map((a, k) => [a.id, k]));
  const inserts = events.filter((e) => e.op === OP.INS && e.t != null);
  const largest = inserts.reduce((m, e) => (e.text.length > (m ? m.text.length : 0) ? e : m), null);

  // Character-weighted category shares across the whole document.
  const catChars = Object.fromEntries(Object.values(CAT).map((c) => [c, 0]));
  let totalChars = 0;
  for (const t of tabsOut) for (const s of t.spans) { catChars[s.cat] += s.m.n; totalChars += s.m.n; }
  const shares = Object.fromEntries(Object.entries(catChars).map(([c, n]) => [c, totalChars ? n / totalChars : 0]));
  const preChars = allRecs.filter((r) => r.pre && !/\s/.test(r.c)).length;
  const mainText = tabsOut.length ? tabsOut[0].text : '';
  const words = (mainText.match(/\S+/g) || []).length;

  const banners = ['evidence'];
  if (!caps.pasteMarker) banners.push('noPasteMarker');
  if (preChars > 20) banners.push('historyStart');
  if (cmp.status === 'mismatch' || cmp.status === 'close') banners.push('mismatch');
  if (cmp.status === 'unverified') banners.push('unverified');
  if (lin.stats.unknown > 0 || lin.stats.outOfRange > 0) banners.push('partial');
  if (actors.length > 1) banners.push('collaborators');

  const completeness = cmp.status === 'exact' && !lin.stats.outOfRange ? 'verified'
    : cmp.status === 'unverified' ? 'unverified'
      : cmp.status === 'mismatch' ? 'unclear' : 'partial';

  const compact = events.map((e) => ({
    i: e.i, t: e.t, a: actorIndex.has(e.actor) ? actorIndex.get(e.actor) : -1, op: e.op, pos: e.pos, len: e.len,
    n: e.text.length, x: e.text.length > 160 ? e.text.slice(0, 160) : e.text, tab: e.tab,
  }));

  return {
    version: ANALYSIS_VERSION,
    caps,
    tabs: tabsOut,
    actors,
    events: compact,
    summary: {
      words,
      activeMs: time.activeMs,
      sessions: time.sessions.length,
      activeDays: time.activeDays,
      firstT: time.firstT,
      lastT: time.lastT,
      editors: actors.length,
      largestInsert: largest ? { i: largest.i, n: largest.text.length, t: largest.t } : null,
      shares,
      historyStart: preChars > 20,
      completeness,
      revisions: parsed.entries.length,
    },
    timeline: {
      sessions: activity(events, time.sessions),
      large: inserts.filter((e) => e.text.length >= THRESHOLDS.largeInsertion).map((e) => ({ i: e.i, t: e.t, n: e.text.length })),
      removals: lin.largeRemovals,
    },
    banners,
    diagnostics: {
      ...diag,
      badEntries: parsed.badEntries,
      revisions: parsed.entries.length,
      tiles: tiles ? { lastRev: tiles.lastRev, firstRev: tiles.firstRev } : null,
      lineage: lin.stats,
      compare: { reference: ref.kind, status: cmp.status, ratio: cmp.ratio, matchedState: chosen.matchedState },
      deleteInclusive: chosen.opts.deleteInclusive,
      tries: tries.map((a) => ({ deleteInclusive: a.opts.deleteInclusive, ratio: a.cmp.ratio, outOfRange: a.lin.stats.outOfRange })),
      typedBatchMedian: median(inserts.map((e) => e.text.length)),
      maxBatch: largest ? largest.text.length : 0,
      timesInMs: time.firstT == null ? null : time.firstT > 1e12,
      textOps: events.filter((e) => TEXT_OPS.has(e.op)).length,
    },
    _events: events,
  };
}
