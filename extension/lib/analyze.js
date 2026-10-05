// The whole analysis, from raw history pages to the model the viewer draws.
// Pure: no chrome.*, no fetch, no DOM. The viewer runs it in a worker and the
// tests run it in Node.

import { parsePages, parseBody, diagnostics, snapshotCommands } from './gdocs/parse.js';
import { normalize, textOfCommands } from './gdocs/normalize.js';
import { displayText, isBlank } from './gdocs/kixtext.js';
import { buildLineage } from './lineage.js';
import { segment } from './segment.js';
import { compareText } from './compare.js';
import { passageMetrics, passageEvents, timing, activity } from './metrics.js';
import { classify, revisionLevel, largeInsertionFor, THRESHOLDS as BASE, CAT } from './classify.js';
import { OP, TEXT_OPS, SOURCE, CONF } from './events.js';
import { survivingOffsets, originalOf } from './original.js';
import { ownerFn, contributions, isStudentOwner, OWNER_PROVIDED, OWNER_TEACHER, ROLE } from './authors.js';
import { whenFn } from './when.js';
import { sectionsOf } from './sections.js';
import { sectionTimes } from './sectiontime.js';
import { deletedPastes, retypedMatch } from './retyped.js';
import { blocksFromHtml, applyHtmlHeadings } from './gdocs/htmlheadings.js';

export const ANALYSIS_VERSION = 1;

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function paragraphsOf(arr) {
  const seg = segment(arr, BASE);
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

// A copied document (a Classroom "copy for each student", File > Make a copy)
// can begin with the whole template arriving in its very first edit. That is
// the starting text, not the student's writing. Only the first saved change
// is considered, and only if it adds real text.
export const START_TEXT_MIN = 20;

export function startText(events) {
  const timed = events.filter((e) => e.t != null && (e.op === OP.INS || e.op === OP.RESET));
  if (!timed.length) return null;
  const group = timed[0].group;
  const first = timed.filter((e) => e.group === group);
  const chars = first.reduce((n, e) => n + e.text.replace(/\s/g, '').length, 0);
  return chars >= START_TEXT_MIN ? { group, chars, actor: first[0].actor, t: first[0].t } : null;
}

function attempt(parsed, opts, ref, startAsProvided, asOf) {
  let events = normalize(parsed, opts);
  const start = startText(events);
  if (start && startAsProvided) {
    for (const e of events) {
      if (e.group === start.group && e.t != null && e.op === OP.INS) Object.assign(e, { source: SOURCE.HISTORY_START, srcConf: CONF.INFERRED });
    }
  }
  // "As of": the history up to that moment. Events are in revision order, so
  // this is a prefix and event numbers stay the same as in the full view.
  if (asOf != null) {
    const cut = events.findIndex((e) => e.t != null && e.t > asOf);
    if (cut >= 0) events = events.slice(0, cut);
  }
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
  return { opts, events, lin, cmp: best, matchedState, start };
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

function majorityOwner(recs, ownerOf) {
  const n = new Map();
  for (const r of recs) if (!isBlank(r.c)) { const o = ownerOf(r); n.set(o, (n.get(o) || 0) + 1); }
  let best = null, max = -1;
  for (const [o, c] of n) if (c > max) { best = o; max = c; }
  return best ?? OWNER_PROVIDED;
}

export function analyze(input) {
  const caps = { pasteMarker: false, ...(input.capabilities || {}) };
  const parsed = parsePages(input.pages || []);
  const diag = diagnostics(parsed.entries);
  const ref = referenceTexts(input);
  const tiles = readTiles(input.tilesBody);

  // Try both readings of delete ranges; keep the one Google's text agrees with.
  // An "as of" view reuses the reading the full analysis chose, and has no
  // copy of Google's text from that moment to check against.
  const startAsProvided = input.startAsProvided !== false;
  const asOf = typeof input.asOf === 'number' ? input.asOf : null;
  const useRef = asOf == null ? ref : { kind: 'none', texts: [] };
  const readings = typeof input.deleteInclusive === 'boolean' ? [input.deleteInclusive] : [true, false];
  const tries = readings.map((inc) => attempt(parsed, { deleteInclusive: inc }, useRef, startAsProvided, asOf));
  const score = (a) => [a.cmp.ratio ?? -1, -a.lin.stats.outOfRange];
  tries.sort((a, b) => {
    const [ra, oa] = score(a), [rb, ob] = score(b);
    return rb - ra || ob - oa;
  });
  const chosen = tries[0];
  const { events, lin } = chosen;

  // Editors and their roles. The teacher's own account is recognized when the
  // page tells us who is signed in; anyone else is a student until marked.
  const actors = actorTable(events, tiles && tiles.userMap);
  const roles = { ...(input.roles || {}) };
  for (const a of actors) {
    a.isSelf = !!input.selfId && a.id === input.selfId;
    if (!roles[a.id] && a.isSelf) roles[a.id] = ROLE.TEACHER;
    a.role = roles[a.id] || ROLE.STUDENT;
  }
  const ownerOf = ownerFn(roles);
  const THRESHOLDS = { ...BASE, largeInsertion: largeInsertionFor(events.filter((e) => e.op === OP.INS && e.t != null).map((e) => e.text.length)) };
  const segOpts = { ...THRESHOLDS, ownerOf };
  const whenOf = whenFn(input.schedule || null, typeof input.dueAt === 'number' ? input.dueAt : null);

  // History-start content and mismatched paragraphs become "unclear".
  let cmp = chosen.cmp;
  const tabsOut = [];
  const allRecs = [];
  const htmlBlocks = blocksFromHtml(input.exportHtml);
  const htmlHeadings = htmlBlocks.filter((b) => b.level != null);
  let htmlMatched = 0;
  const headingMarks = [];
  const marksIn = new Map((Array.isArray(input.headingMarks) ? input.headingMarks : []).map(([mark, level, hid]) => [mark, { level, hid }]));
  const survivors = survivingOffsets([...lin.tabs.values()].flat(), THRESHOLDS.largeInsertion);
  // Pastes that were deleted again, and the passages rewritten from them.
  const pastesGone = deletedPastes({
    events, finals: [...lin.tabs.values()], goneAt: lin.goneAt, internal: lin.internal,
    large: THRESHOLDS.largeInsertion, isStudent: (id) => (roles[id] || ROLE.STUDENT) === ROLE.STUDENT,
  });
  const retypedSources = [];
  const sourceIdx = new Map();
  const sourceOf = (m) => {
    if (!sourceIdx.has(m.ev)) { sourceIdx.set(m.ev, retypedSources.length); retypedSources.push({ text: m.text, cut: m.cut, t: m.t, goneT: m.goneT }); }
    return sourceIdx.get(m.ev);
  };
  for (const [tabId, arr] of lin.tabs) {
    if (tabId === '' && cmp.mismatched.size) {
      const first = segment(arr, THRESHOLDS);
      first.paragraphs.forEach((p, idx) => {
        if (!cmp.mismatched.has(idx)) return;
        for (let d = p.start; d < p.end; d++) arr[first.map[d]].unclear = true;
      });
    }
    const seg = segment(arr, segOpts);
    // Headings as Google's own HTML copy marks them, for paragraphs the
    // history's style commands left unstyled.
    if (htmlHeadings.length) htmlMatched += applyHtmlHeadings(seg.paragraphs, seg.paragraphs.map((p) => seg.text.slice(p.start, p.end)), htmlBlocks);
    // A heading is also known by the character it starts with, which stays
    // the same when its text changes: an "as of" view of an earlier moment
    // is given the full view's marks (input.headingMarks) and finds its
    // headings that way.
    const firstRec = (p) => {
      for (let d = p.start; d < p.end; d++) { const r = arr[seg.map[d]]; if (!isBlank(r.c)) return r; }
      return null;
    };
    seg.paragraphs.forEach((p) => {
      const r = firstRec(p);
      if (!r) return;
      const mark = `${r.ev}:${r.off}`;
      if (p.ps && Number(p.ps.h)) { if (headingMarks.length < 5000) headingMarks.push(p.ps.hid ? [mark, Number(p.ps.h), p.ps.hid] : [mark, Number(p.ps.h)]); return; }
      const got = marksIn.get(mark);
      if (got && got.level) p.ps = { ...(p.ps || {}), h: got.level, ...(typeof got.hid === 'string' && !(p.ps && p.ps.hid) ? { hid: got.hid } : {}) };
    });
    // What a large insertion first said, worked out once per sentence so every
    // piece of a split sentence shows the same before and after.
    const origBySentence = new Map();
    const originalFor = (s) => {
      const key = `${s.sent[0]}:${s.sent[1]}`;
      if (!origBySentence.has(key)) {
        const recs = [];
        for (let d = s.sent[0]; d < s.sent[1]; d++) recs.push(arr[seg.map[d]]);
        origBySentence.set(key, originalOf(recs, events, survivors, seg.text.slice(s.sent[0], s.sent[1]), THRESHOLDS));
      }
      return origBySentence.get(key);
    };
    const spans = seg.spans.map((s, k) => {
      const recs = [];
      for (let d = s.start; d < s.end; d++) recs.push(arr[seg.map[d]]);
      // Deletion credit sits on the character before a gap, which may be a
      // space just outside the trimmed passage; pull in trailing whitespace.
      for (let d = s.end; d < seg.text.length && /\s/.test(seg.text[d]) && seg.text[d] !== '\n'; d++) recs.push(arr[seg.map[d]]);
      const m = passageMetrics(recs, lin.replacements, THRESHOLDS);
      const owner = majorityOwner(recs, ownerOf);
      // Provided and teacher text is set aside, not judged.
      const { cat, badges } = owner === OWNER_PROVIDED ? { cat: CAT.PROVIDED, badges: [] }
        : owner === OWNER_TEACHER ? { cat: CAT.TEACHER, badges: [] }
          : classify(m, caps);
      // A large insertion that was then revised keeps its category and gains
      // a revision level, drawn as stripes.
      const sub = cat === CAT.LARGE ? revisionLevel(m) : null;
      const ev = passageEvents(recs, events);
      const words = (seg.text.slice(s.start, s.end).match(/\S+/g) || []).length;
      const orig = isStudentOwner(owner) ? originalFor(s) : null;
      const rt = isStudentOwner(owner) && cat !== CAT.LARGE ? retypedMatch(recs, seg.text.slice(s.sent[0], s.sent[1]), pastesGone, THRESHOLDS.largeInsertion) : null;
      if (rt) badges.push('retyped');
      return { id: `${tabId || 'main'}:${k}`, tab: tabId, start: s.start, end: s.end, para: s.para, owner, cat, sub, badges, m, words, events: ev.events, eventsTotal: ev.total, runs: ev.runs, part: ev.part, orig, partOfSentence: !!orig && (s.sent[0] !== s.start || s.sent[1] !== s.end), retyped: rt ? { src: sourceOf(rt), shared: rt.shared, of: rt.of } : null };
    });
    allRecs.push(...arr);
    // When each student character was written, as runs over the display text.
    const whenRuns = [];
    seg.map.forEach((k, d) => {
      const r = arr[k];
      const w = r.t != null && ownerOf(r).startsWith('student:') ? whenOf(r.t) : null;
      const last = whenRuns[whenRuns.length - 1];
      if (last && last.w === w && last.end === d) last.end = d + 1;
      else if (w) whenRuns.push({ start: d, end: d + 1, w });
    });
    // Sections: the Doc's headings. A Doc with no headings at all falls back
    // to the template's own lines ("Hypothesis:"), so there is still
    // something to jump to and to line up across a class.
    const headingsOnly = input.headingsOnly !== false;
    let sections = sectionsOf(seg, arr, ownerOf, spans, { headingsOnly });
    let sectionsFrom = headingsOnly ? 'headings' : 'all';
    if (headingsOnly && !sections.length) {
      sections = sectionsOf(seg, arr, ownerOf, spans, { headingsOnly: false });
      sectionsFrom = sections.length ? 'template' : 'none';
    }
    tabsOut.push({ id: tabId, text: seg.text, paragraphs: seg.paragraphs, layout: seg.layout, runs: seg.runs, whenRuns, spans, sections, sectionsFrom });
  }
  tabsOut.sort((a, b) => (a.id === '' ? -1 : b.id === '' ? 1 : a.id.localeCompare(b.id)));
  sectionTimes(tabsOut, events, (id) => ((roles[id] || ROLE.STUDENT) === ROLE.STUDENT ? `student:${id}` : null));

  const time = timing(events);
  const actorIndex = new Map(actors.map((a, k) => [a.id, k]));
  const inserts = events.filter((e) => e.op === OP.INS && e.t != null);
  const largest = inserts.reduce((m, e) => (e.text.length > (m ? m.text.length : 0) ? e : m), null);

  // Character-weighted category shares across the students' text only.
  const catChars = Object.fromEntries(Object.values(CAT).map((c) => [c, 0]));
  let totalChars = 0;
  for (const t of tabsOut) for (const s of t.spans) if (isStudentOwner(s.owner)) { catChars[s.cat] += s.m.n; totalChars += s.m.n; }
  const allSpans = tabsOut.flatMap((t) => t.spans);
  const contrib = contributions({ recs: allRecs, events, actors, spans: allSpans, roles, removedProvided: lin.removedProvided, largeInsertion: THRESHOLDS.largeInsertion, whenOf, internal: lin.internal });
  const shares = Object.fromEntries(Object.entries(catChars).map(([c, n]) => [c, totalChars ? n / totalChars : 0]));
  const preChars = allRecs.filter((r) => r.pre && !isBlank(r.c)).length;
  const mainText = tabsOut.length ? tabsOut[0].text : '';
  const words = (mainText.match(/\S+/g) || []).length;

  const banners = ['evidence'];
  if (!caps.pasteMarker) banners.push('noPasteMarker');
  if (chosen.start) banners.push(startAsProvided ? 'startProvided' : 'startStudent');
  else if (preChars > 20) banners.push('historyStart');
  if (cmp.status === 'mismatch' || cmp.status === 'close') banners.push('mismatch');
  if (cmp.status === 'unverified' && asOf == null) banners.push('unverified');
  if (asOf != null) banners.push('asOf');
  if (lin.stats.unknown > 0 || lin.stats.outOfRange > 0) banners.push('partial');
  if (actors.filter((a) => a.role === ROLE.STUDENT).length > 1) banners.push('collaborators');

  const completeness = cmp.status === 'exact' && !lin.stats.outOfRange ? 'verified'
    : cmp.status === 'unverified' ? 'unverified'
      : cmp.status === 'mismatch' ? 'unclear' : 'partial';

  const compact = events.map((e) => ({
    i: e.i, t: e.t, a: actorIndex.has(e.actor) ? actorIndex.get(e.actor) : -1, op: e.op, pos: e.pos, len: e.len,
    n: e.text.length, x: e.text.length > 160 ? e.text.slice(0, 160) : e.text, tab: e.tab,
  }));

  return {
    largeInsertion: THRESHOLDS.largeInsertion,
    retypedSources,
    version: ANALYSIS_VERSION,
    caps,
    headingMarks,
    tabs: tabsOut,
    actors,
    roles,
    contributions: contrib,
    events: compact,
    summary: {
      words,
      activeMs: time.activeMs,
      sessions: time.sessions.length,
      activeDays: time.activeDays,
      firstT: time.firstT,
      lastT: time.lastT,
      editors: actors.length,
      studentShare: contrib.studentShare,
      studentWords: contrib.editors.reduce((s, e) => s + (e.words || 0), 0),
      largestInsert: largest ? { i: largest.i, n: largest.text.length, t: largest.t } : null,
      shares,
      historyStart: preChars > 20,
      startText: chosen.start ? { chars: chosen.start.chars, asProvided: startAsProvided } : null,
      asOf,
      when: (() => {
        const w = contrib.studentWhen, n = w.school + w.home + w.late;
        return { chars: w, shares: n ? { school: w.school / n, home: w.home / n, late: w.late / n } : { school: 0, home: 0, late: 0 }, scheduled: !!input.schedule, dueAt: input.dueAt ?? null };
      })(),
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
      htmlHeadings: { found: htmlHeadings.length, matched: htmlMatched, fetched: typeof input.exportHtml === 'string' },
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
