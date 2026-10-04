// Tests. Each one is a claim Writing Heatmap makes about itself; if one fails,
// that claim is no longer true. Run: npm test

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripXssi, parsePages, flatten, diagnostics, describeBody } from '../extension/lib/gdocs/parse.js';
import { normalize } from '../extension/lib/gdocs/normalize.js';
import { parseDocUrl, parseFileUrl, findInfoParams, loadUrl, tilesUrl, VARIANTS, KIND } from '../extension/lib/gdocs/endpoints.js';
import { displayText } from '../extension/lib/gdocs/kixtext.js';
import { headingsFromHtml } from '../extension/lib/gdocs/htmlheadings.js';
import { buildLineage, tabText } from '../extension/lib/lineage.js';
import { makeEvent, OP as EOP } from '../extension/lib/events.js';
import { segment } from '../extension/lib/segment.js';
import { passageMetrics, timing } from '../extension/lib/metrics.js';
import { classify, THRESHOLDS, CAT } from '../extension/lib/classify.js';
import { compareText } from '../extension/lib/compare.js';
import { analyze } from '../extension/lib/analyze.js';
import { Replayer, applyToText, expandRuns } from '../extension/lib/replay.js';
import { expiredKeys, expiresAt } from '../extension/lib/ttl.js';
import { checkFixtureText } from './check-fixtures.js';
import { scrub } from './scrub-fixture.js';
import { Synth, lorem } from '../tests/synth.js';
import { parseLinks, rowMetrics, commonSections, majoritySections, sliceSection, toCsv } from '../extension/lib/classroom.js';
import { diffWords } from '../extension/lib/original.js';
import { buildPack, readPack, mergePack } from '../extension/lib/pack.js';
import { timelineModel } from '../extension/lib/timeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`); }
function near(a, b, msg, tol = 1e-9) { if (Math.abs(a - b) > tol) throw new Error(`${msg} (got ${a}, expected ${b})`); }

// The span whose text contains `marker`.
function spanWith(result, marker) {
  for (const t of result.tabs) {
    for (const s of t.spans) if (t.text.slice(s.start, s.end).includes(marker)) return s;
  }
  throw new Error(`no passage contains ${marker}`);
}

console.log('\nGoogle history parsing');

check('the XSSI prefix is stripped in either common form', () => {
  eq(stripXssi(")]}'\n{\"a\":1}"), '{"a":1}', 'newline form');
  eq(stripXssi(")]}'{\"a\":1}"), '{"a":1}', 'no newline');
});

check('mlti and nm wrappers flatten, and nm keeps its tab id', () => {
  const seen = [];
  flatten({ ty: 'mlti', mts: [{ ty: 'is', ibi: 1, s: 'a' }, { ty: 'nm', nmr: ['ksm', 't.abc'], nmc: { ty: 'ds', si: 1, ei: 1 } }] }, '', (c, tab) => seen.push(`${c.ty}@${tab}`));
  eq(seen.join(','), 'is@,ds@t.abc', 'leaves');
});

check('overlapping pages are de-duplicated by revision number', () => {
  const s = new Synth().type('hello world');
  const p = s.pages(2);
  const both = [p[0], ...p];
  eq(parsePages(both).entries.length, s.log.length, 'entries');
});

check('unknown commands are counted, not dropped silently', () => {
  const s = new Synth().type('abc').entry({ ty: 'zzz', q: 1 });
  const lin = buildLineage(normalize(parsePages([s.page()])));
  eq(lin.stats.unknown, 1, 'unknown');
  const d = diagnostics(parsePages([s.page()]).entries);
  eq(d.counts.zzz, 1, 'diagnostic count');
  assert(d.keys.zzz.includes('q'), 'keys recorded');
});

check('doc URLs and page tokens are read', () => {
  const u = parseDocUrl('https://docs.google.com/document/u/1/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit');
  eq(u.docId, '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'id');
  eq(u.u, 1, 'account index');
  const p = findInfoParams('x={"info_params":{"token":"AC4w5V","ouid":"u123"}}');
  eq(p.token, 'AC4w5V', 'token');
  eq(p.ouid, 'u123', 'ouid');
  assert(loadUrl({ docId: 'D'.repeat(25), token: 'T' }, VARIANTS[1], 1, 5).includes('/u/0/d/'), 'variant B uses the account path');
});

check('Slides deck URLs are read, and their history URLs stay on the deck', () => {
  const id = '1SlIdEsDeCkAbCdEfGhIjKlMnOpQrStU';
  const f = parseFileUrl(`https://docs.google.com/presentation/u/2/d/${id}/edit#slide=id.p`);
  eq(JSON.stringify(f), JSON.stringify({ kind: KIND.SLIDES, docId: id, u: 2 }), 'kind, id, account');
  eq(parseDocUrl(`https://docs.google.com/presentation/d/${id}/edit`), null, 'a deck is not a Doc for the class dashboard');
  eq(parseFileUrl(`https://docs.google.com/document/d/${id}/edit`).kind, KIND.DOC, 'a Doc is still a Doc');
  const ctx = { kind: KIND.SLIDES, docId: id, u: 2, token: 'T' };
  const url = loadUrl(ctx, VARIANTS[1], 1, 5);
  assert(url.startsWith(`https://docs.google.com/presentation/u/2/d/${id}/revisions/load?`), url);
  assert(!/[?&]tab=/.test(url), 'no Docs tab parameter on a deck');
  assert(tilesUrl(ctx).includes('/presentation/u/2/d/'), 'tiles on the deck');
  assert(/[?&]tab=t\.0/.test(loadUrl({ docId: id, token: 'T' }, VARIANTS[1], 1, 5)), 'Docs keep their tab parameter');
});

check('a probe reply is described by its shape, not its content', () => {
  const d = describeBody(")]}'\n" + JSON.stringify({ changelog: [[{ ty: 'zz', s: 'secret words' }, 1700000000000, 'u1', 1, 's1']], chunkedSnapshot: [] }));
  eq(JSON.stringify(d.keys), '["changelog","chunkedSnapshot"]', 'keys');
  eq(d.changelog, 1, 'entries');
  eq(d.first.join(','), '{ty,s},number,string,number,string', 'entry layout');
  assert(!JSON.stringify(d).includes('secret'), 'no text');
  eq(describeBody('<html>sign in</html>').json, false, 'not JSON');
});

check('control characters display as gaps and private-use chips vanish', () => {
  eq(displayText('a\u000bb\u001cc\ue907d'), 'a\nb\tcd', 'flat display: a cell reads as a tab');
});

console.log('\nRebuilding the text');

check('typed text rebuilds exactly', () => {
  const s = new Synth().type('The quick brown fox.').backspace(1).type('!');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  eq(tabText(lin.tabs.get('')), s.text, 'text');
  eq(lin.mirrors.get(''), s.text, 'the copy-check mirror stays in step');
});

check('ordinary repeated phrases are not mistaken for copied text', () => {
  const s = new Synth();
  for (let k = 0; k < 20; k++) s.type('the water cycle moves water around. ', { chunk: 24 });
  const lin = buildLineage(normalize(parsePages([s.page()])));
  eq(lin.stats.copies, 0, 'no copies from 24-character typing bursts');
});

check('a paragraph rewritten 150 times still analyses quickly', () => {
  const s = new Synth();
  s.type(`${lorem(200, 1)}\nTarget paragraph ${lorem(40, 2)}\n${lorem(200, 3)}`, { chunk: 6 });
  for (let k = 0; k < 150; k++) {
    const at = s.find('Target paragraph') + 17;
    const end = s.text.indexOf('\n', at);
    for (let j = end; j > at; j -= 3) s.wait(100).del(Math.max(at, j - 3), Math.min(3, j - at));
    s.type(lorem(40, k + 9), { at, chunk: 2 });
  }
  const t0 = Date.now();
  const r = analyze({ pages: s.pages(1000), exportText: s.text });
  assert(Date.now() - t0 < 8000, `took ${Date.now() - t0} ms`);
  eq(r.summary.completeness, 'verified', 'verified');
  eq(spanWith(r, 'Target paragraph').cat, CAT.HEAVY, 'heavily revised');
});

check('inclusive and exclusive delete ranges both rebuild when read the right way', () => {
  const inc = new Synth({ inclusive: true }).type('abcdef').del(1, 2);
  const exc = new Synth({ inclusive: false }).type('abcdef').del(1, 2);
  eq(tabText(buildLineage(normalize(parsePages([inc.page()]), { deleteInclusive: true })).tabs.get('')), 'adef', 'inclusive');
  eq(tabText(buildLineage(normalize(parsePages([exc.page()]), { deleteInclusive: false })).tabs.get('')), 'adef', 'exclusive');
});

check('analyze picks the delete reading that matches Google’s text', () => {
  const exc = new Synth({ inclusive: false }).type('First line here.\nSecond line goes here.').del(3, 4).type(' more', { at: 10 });
  const r = analyze({ pages: [exc.page()], exportText: exc.text });
  eq(r.diagnostics.deleteInclusive, false, 'chose exclusive');
  eq(r.summary.completeness, 'verified', 'verified');
});

check('text present before the history begins is marked pre-existing', () => {
  const s = new Synth().preexisting('Assignment heading from the template\n').type('My answer.');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  const arr = lin.tabs.get('');
  eq(tabText(arr), s.text, 'text');
  assert(arr[0].pre && !arr[arr.length - 1].pre, 'pre flag');
});

check('cut and paste is a move: the text keeps its original history', () => {
  const s = new Synth().type('Alpha sentence typed here. ').type('Bravo sentence typed after it. ');
  s.cutPaste('Alpha sentence typed here. ', (x) => x.text.length);
  const lin = buildLineage(normalize(parsePages([s.page()])));
  const arr = lin.tabs.get('');
  eq(tabText(arr), s.text, 'text');
  eq(lin.stats.moves, 1, 'one move');
  const a = arr[s.find('Alpha')];
  assert(a.moved >= 0 && a.batch < 80 && a.rev === 0, 'moved text keeps its typed origin and gets no credit');
});

check('copying text already in the document inherits its history', () => {
  const s = new Synth().type('Repeated phrase that is comfortably long enough to count. ');
  s.wait(5000).insert('Repeated phrase that is comfortably long enough to count. ');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  eq(lin.stats.copies, 1, 'one copy');
  const arr = lin.tabs.get('');
  const second = arr[s.find('Repeated', 5)];
  assert(second.moved >= 0 && second.batch < 80, 'copy inherits typed origin');
});

check('typing over a selection credits the new text with what it replaced', () => {
  const s = new Synth().type('The cat sat on the mat.');
  s.minutes(1).retype('cat', 'dog');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  const arr = lin.tabs.get('');
  const d = arr[s.find('dog')];
  assert(d.rev > 0 && d.repl >= 0, 'replacement credit');
  near(arr.reduce((a, r) => a + r.rev, 0), 3, 'credit equals the 3 removed characters');
});

console.log('\nMeasures and categories');

check('revision load: 100 typed characters with 12 deleted = 0.12', () => {
  const recs = Array.from({ length: 100 }, () => ({ c: 'x', t: 1, rev: 0, post: 0, removedNear: 0, repl: -1, frontier: true, batch: 3, moved: -1 }));
  recs[50].rev = 12;
  const m = passageMetrics(recs, new Map(), THRESHOLDS);
  near(m.revisionLoad, 0.12, 'revisionLoad');
  near(m.linearity, 1, 'linearity');
  eq(m.n, 100, 'n');
});

check('category boundaries sit exactly on the research thresholds', () => {
  const base = { unclearShare: 0, pasteShare: 0, largeShare: 0, revisionLoad: 0, postShare: 0, linearity: 1, heavyRepl: false, movedShare: 0, sugShare: 0, removedNear: 0 };
  const c = (o, caps) => classify({ ...base, ...o }, caps).cat;
  eq(c({}), CAT.LINEAR, 'clean');
  eq(c({ revisionLoad: 0.0999 }), CAT.LINEAR, 'just under light');
  eq(c({ revisionLoad: 0.10 }), CAT.LIGHT, 'light at 0.10');
  eq(c({ revisionLoad: 0.3499 }), CAT.LIGHT, 'just under heavy');
  eq(c({ revisionLoad: 0.35 }), CAT.HEAVY, 'heavy at 0.35');
  eq(c({ postShare: 0.0499 }), CAT.LINEAR, 'post just under light');
  eq(c({ postShare: 0.05 }), CAT.LIGHT, 'post light');
  eq(c({ postShare: 0.20 }), CAT.HEAVY, 'post heavy');
  eq(c({ heavyRepl: true }), CAT.HEAVY, 'heavy replacement');
  eq(c({ largeShare: 0.5999 }), CAT.MIXED, 'large just under 0.60 is not linear');
  eq(c({ largeShare: 0.60 }), CAT.LARGE, 'large at 0.60');
  eq(c({ largeShare: 0.0999 }), CAT.LINEAR, 'small large share still linear');
  eq(c({ largeShare: 0.10 }), CAT.MIXED, 'large share 0.10 blocks linear');
  eq(c({ linearity: 0.8999 }), CAT.MIXED, 'linearity under 0.90');
  eq(c({ unclearShare: 0.51 }), CAT.UNCLEAR, 'unclear');
  eq(c({ pasteShare: 0.7 }), CAT.MIXED, 'no paste marker: pasted cannot fire');
  eq(c({ pasteShare: 0.7 }, { pasteMarker: true }), CAT.PASTED, 'with a marker it does');
});

check('a pasted paragraph is never "composed in place"', () => {
  const s = new Synth().type('Typed opener sentence. ').insert('Inserted sentence one is here and it keeps going. Inserted sentence two is also long enough to count.');
  const r = analyze({ pages: [s.page()], exportText: s.text });
  eq(spanWith(r, 'Inserted sentence one').cat, CAT.LARGE, 'large');
  eq(spanWith(r, 'Typed opener').cat, CAT.LINEAR, 'typed stays linear');
});

check('sessions split after 30 idle minutes; active time skips gaps over 2 minutes', () => {
  const s = new Synth().type('abc', { cps: 3, chunk: 1 }).minutes(31).type('def', { cps: 3, chunk: 1 });
  const t = timing(normalize(parsePages([s.page()])));
  eq(t.sessions.length, 2, 'sessions');
  near(t.activeMs, 4 * 333, 'active ms: two 333 ms gaps per session');
});

check('a sentence with two clearly different histories splits into sub-spans of 20+ characters', () => {
  const s = new Synth().type('Typed words come first in this sentence, ');
  s.insert('then a long inserted clause arrives here all at once with plenty and plenty of characters.');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  const seg = segment(lin.tabs.get(''), THRESHOLDS);
  eq(seg.spans.length, 2, 'two sub-spans');
  assert(seg.spans.every((x) => x.end - x.start >= 20), 'each at least 20');
});

check('a short odd run inside a sentence does not split it', () => {
  const s = new Synth().type('Plain typed sentence that runs on for a while ');
  s.insert('x'.repeat(10));
  s.type(' and ends here.');
  const lin = buildLineage(normalize(parsePages([s.page()])));
  eq(segment(lin.tabs.get(''), THRESHOLDS).spans.length, 1, 'one span');
});

console.log('\nThe planted essay');

function plantedEssay() {
  const s = new Synth().preexisting('Template prompt text that the teacher put in the document.\n');
  s.type(`ALPHA ${lorem(30, 3)}. ${lorem(25, 4)}.`);
  s.type(' ECHO this sentence will be moved later on.');
  s.type('\n');
  s.minutes(3).insert(`BRAVO ${lorem(70, 5)}.`);
  s.type('\n');
  s.minutes(2).type(`CHARLIE ${lorem(20, 6)}.`);
  s.type('\n');
  s.type(`DELTA ${lorem(30, 7)} final words of delta.`);
  s.type('\n');
  s.type(`FOXTROT ${lorem(40, 8)}.`);
  // Much later: come back and rewrite CHARLIE almost entirely.
  s.minutes(45);
  const from = s.find('CHARLIE') + 8;
  s.retype(s.text.slice(from, s.find('.', from)), lorem(22, 9), { from });
  // Light touch on DELTA: replace three words.
  s.minutes(1).retype('final words of delta', 'last words of the delta part');
  // Move ECHO to the end of the DELTA paragraph.
  s.minutes(1).cutPaste(' ECHO this sentence will be moved later on.', (x) => x.find('delta part.') + 'delta part.'.length);
  return s;
}

check('each planted passage gets its expected category, and only those', () => {
  const s = plantedEssay();
  const r = analyze({ pages: s.pages(50), exportText: s.text });
  eq(r.summary.completeness, 'verified', 'rebuild verified');
  eq(spanWith(r, 'Template prompt').cat, CAT.PROVIDED, 'template');
  eq(spanWith(r, 'ALPHA').cat, CAT.LINEAR, 'alpha');
  eq(spanWith(r, 'BRAVO').cat, CAT.LARGE, 'bravo');
  eq(spanWith(r, 'CHARLIE').cat, CAT.HEAVY, 'charlie');
  eq(spanWith(r, 'delta part').cat, CAT.LIGHT, 'delta');
  eq(spanWith(r, 'FOXTROT').cat, CAT.LINEAR, 'foxtrot');
  const echo = spanWith(r, 'ECHO');
  assert(echo.badges.includes('moved'), 'echo moved badge');
  assert(r.banners.includes('historyStart') && r.banners.includes('noPasteMarker'), 'banners');
  const other = r.tabs[0].spans.filter((x) => x.cat === CAT.LARGE);
  eq(other.length, 1, 'only BRAVO is a large insertion');
});

check('replay of a passage starts just before its first edit, not at the beginning', () => {
  const s = plantedEssay();
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const rp = new Replayer(r._events);
  const span = spanWith(r, 'CHARLIE');
  const w = rp.window('', span.events);
  assert(w.windows.length >= 1, 'has windows');
  assert(w.windows[0].startText.includes('ALPHA'), 'starts with earlier text already there');
  assert(w.windows[0].steps.some((x) => x.relevant), 'has the passage’s own steps');
});

check('a 1,500-word essay with ~20,000 revisions analyses in under 10 seconds', () => {
  const s = new Synth();
  for (let p = 0; p < 15; p++) {
    s.type(`${lorem(100, p + 11)}.`, { chunk: 1, cps: 6 });
    if (p % 3 === 0) s.backspace(5).type('words');
    s.type('\n', { chunk: 1 });
  }
  assert(s.log.length > 9000, `enough revisions (${s.log.length})`);
  const t0 = Date.now();
  const r = analyze({ pages: s.pages(1000), exportText: s.text });
  const ms = Date.now() - t0;
  assert(ms < 10000, `took ${ms} ms`);
  eq(r.summary.completeness, 'verified', 'verified');
});

console.log('\nThe document’s own formatting');

check('a table rebuilds as rows and cells, with its text still coloured', () => {
  const T = '\u0010\u0012\u001cALPHA cell one typed here\n\u001cBRAVO cell two typed here\n\u0012\u001cCHARLIE cell three\n\u001cDELTA cell four\n\u0011';
  const s = new Synth().type('Intro line before the table.\n');
  s.insert(T);
  s.type('After the table.');
  const r = analyze({ pages: [s.page()], exportText: 'Intro line before the table.\nALPHA cell one typed here\tBRAVO cell two typed here\nCHARLIE cell three\tDELTA cell four\nAfter the table.' });
  eq(r.summary.completeness, 'verified', 'table text matches Google’s export');
  const marks = r.tabs[0].layout.filter((x) => x.m).map((x) => ({ '\u0010': 'T', '\u0011': '/T', '\u0012': 'R', '\u001c': 'C' }[x.m])).join(' ');
  eq(marks, 'T R C C R C C /T', 'table structure');
  assert(spanWith(r, 'BRAVO cell two').end - spanWith(r, 'BRAVO cell two').start < 30, 'cells are separate passages');
});

check('bold, italic, headings and lists carry through to the viewer', () => {
  const s = new Synth().type('Title line\nBody with bold words in it.\nA list item\n');
  s.style(s.find('bold'), 4, 'text', { ts_bd: true });
  s.style(s.find('words'), 5, 'text', { ts_it: true, ts_bd_i: true });
  s.style(s.find('Title line\n'), 11, 'paragraph', { ps_hd: 1 });
  s.style(s.find('A list item\n'), 12, 'list', { ls_id: 'kix.abc', ls_nest: 0 });
  s.type('Typed after the list.');
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const t = r.tabs[0];
  const run = t.runs.find((x) => t.text.slice(x.start, x.end) === 'bold');
  assert(run && run.ts.b === true, 'bold run');
  const it = t.runs.find((x) => t.text.slice(x.start, x.end) === 'words');
  assert(it && it.ts.i === true && it.ts.b === undefined, 'italic run, inherit flag ignored');
  eq(t.paragraphs[0].ps.h, 1, 'heading 1');
  eq(t.paragraphs[2].ps.list, 'kix.abc', 'list paragraph');
});

check('formatting in the starting snapshot is kept', () => {
  const snap = [[{ ty: 'is', ibi: 1, s: 'Template heading\nTemplate body.\n' }, { ty: 'as', st: 'paragraph', si: 1, ei: 17, sm: { ps_hd: 2 } }]];
  const page = `)]}'\n${JSON.stringify({ changelog: new Synth().type('x').log, chunkedSnapshot: snap })}`;
  const r = analyze({ pages: [page], exportText: 'Template heading\nTemplate body.\nx' });
  eq(r.tabs[0].paragraphs[0].ps.h, 2, 'snapshot heading');
  eq(spanWith(r, 'Template body').cat, CAT.PROVIDED, 'still provided');
});

console.log('\nTime: as of, school hours, due date, checkpoints');

// A school-day timeline in local time: Monday 2026-10-05.
const MON = (h, m = 0) => new Date(2026, 9, 5, h, m).getTime();

check('“as of” shows the document exactly as it stood at that moment', () => {
  const s = new Synth({ start: MON(9) }).type('ALPHA first morning sentence typed in class. ');
  const noon = s.t + 1;
  s.wait(3 * 3600 * 1000).type('BRAVO typed in the afternoon later on.');
  const full = analyze({ pages: [s.page()], exportText: s.text });
  const then = analyze({ pages: [s.page()], asOf: noon, deleteInclusive: full.diagnostics.deleteInclusive });
  assert(then.tabs[0].text.includes('ALPHA') && !then.tabs[0].text.includes('BRAVO'), 'only the morning text');
  assert(then.banners.includes('asOf'), 'banner');
  assert(!then.banners.includes('unverified'), 'no unverified banner for past views');
  eq(then.summary.asOf, noon, 'asOf recorded');
});

check('school hours, outside school hours and after the due date are told apart', () => {
  const s = new Synth({ start: MON(10) }).type('ALPHA written during the school day in class. ');
  s.wait(MON(20) - s.t).type('BRAVO written at home in the evening after dinner. ');
  s.wait(new Date(2026, 9, 7, 9).getTime() - s.t).type('CHARLIE written after it was due on Wednesday.');
  const schedule = { days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' };
  const r = analyze({ pages: [s.page()], exportText: s.text, schedule, dueAt: new Date(2026, 9, 6, 23, 59).getTime() });
  const t = r.tabs[0];
  const whenAt = (word) => { const k = t.text.indexOf(word); return t.whenRuns.find((x) => x.start <= k && k < x.end).w; };
  eq(whenAt('ALPHA'), 'school', 'school');
  eq(whenAt('BRAVO'), 'home', 'home');
  eq(whenAt('CHARLIE'), 'late', 'late');
  const e = r.contributions.editors[0];
  assert(e.finalWhen.school > 0 && e.finalWhen.home > 0 && e.finalWhen.late > 0, 'per-student split');
  near(r.summary.when.shares.school + r.summary.when.shares.home + r.summary.when.shares.late, 1, 'shares');
});

check('a weekend morning is outside school hours', () => {
  const s = new Synth({ start: new Date(2026, 9, 10, 10).getTime() }).type('ALPHA written on a Saturday morning.');
  const r = analyze({ pages: [s.page()], exportText: s.text, schedule: { days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' } });
  eq(r.tabs[0].whenRuns[0].w, 'home', 'saturday is home');
});

check('sections are the table-of-contents headings only, with words per writer', () => {
  const s = new Synth({ user: 'student-1' });
  s.insert('Science Fair Project\nHypothesis\nWrite one sentence: if I change this, then that will happen.\nProcedure\nProcedure: list your steps\n');
  s.style(0, 21, 'paragraph', { ps_hd: 100 });
  s.style(s.find('Hypothesis'), 11, 'paragraph', { ps_hd: 1 });
  s.style(s.find('Procedure\n'), 10, 'paragraph', { ps_hd: 2 });
  s.minutes(5).type('ALPHA plants grow taller with more light.\n', { at: s.find('Write one sentence') });
  s.as('student-2').minutes(1).type(' first water the plants every day', { at: s.find('list your steps') + 'list your steps'.length });
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const secs = r.tabs[0].sections;
  eq(secs.map((x) => `${x.key}@${x.level}`).join(' | '), 'hypothesis@1 | procedure@2', 'headings only: no title, no template prompts');
  const hyp = secs.find((x) => x.key === 'hypothesis');
  eq(hyp.words['student:student-1'], 7, 'student 1 wrote the hypothesis');
  const proc = secs.find((x) => x.key === 'procedure');
  assert(proc.para === r.tabs[0].paragraphs.findIndex((p) => r.tabs[0].text.slice(p.start, p.end).startsWith('Procedure')), 'procedure starts at its heading');
  assert(proc.words['student:student-2'] >= 6, 'student 2 wrote in the procedure');
});

check('with headings-only turned off, the title and template prompts are sections too', () => {
  const s = new Synth({ user: 'student-1' });
  s.insert('Science Fair Project\nHypothesis\nProcedure: list your steps\n');
  s.style(0, 21, 'paragraph', { ps_hd: 100 });
  s.style(s.find('Hypothesis'), 11, 'paragraph', { ps_hd: 1 });
  s.minutes(5).type(' first water the plants', { at: s.find('list your steps') + 'list your steps'.length });
  const on = analyze({ pages: [s.page()], exportText: s.text });
  eq(on.tabs[0].sections.map((x) => x.key).join(' | '), 'hypothesis', 'on by default: headings only');
  const off = analyze({ pages: [s.page()], exportText: s.text, headingsOnly: false });
  eq(off.tabs[0].sections.map((x) => `${x.key}:${x.kind}`).join(' | '), 'science fair project:heading | hypothesis:heading | procedure: list your steps:prompt', 'off: title and prompts');
});

check('a large insertion that was then revised is striped by how much', () => {
  // Heavy: words cut out in several places, the chunk itself mostly kept.
  const s = new Synth().insert(`BRAVO ${lorem(40, 5)}.`);
  for (const at of [200, 150, 100, 50]) s.minutes(40).del(at, 15);
  const r = analyze({ pages: [s.page()], exportText: s.text, startAsProvided: false });
  const sp = spanWith(r, 'BRAVO');
  eq(sp.cat, CAT.LARGE, 'still a large insertion');
  eq(sp.sub, 'heavy', 'heavily revised stripes');
  // Light: a few words typed over.
  const l = new Synth().insert(`DELTA ${lorem(40, 5)}.`);
  l.minutes(40).retype(l.text.slice(30, 45), 'new words here', { from: 30 });
  const rl = analyze({ pages: [l.page()], exportText: l.text, startAsProvided: false });
  eq(spanWith(rl, 'DELTA').sub, 'light', 'lightly revised stripes');
  const t = new Synth().insert(`CHARLIE ${lorem(40, 5)}.`);
  const r2 = analyze({ pages: [t.page()], exportText: t.text, startAsProvided: false });
  eq(spanWith(r2, 'CHARLIE').sub, null, 'an untouched chunk has no stripes');
});

check('a revised large insertion keeps what it first said, for comparison', () => {
  const s = new Synth().insert('ALPHA the quick brown fox jumps over the lazy dog near the old river bank today. BRAVO this second sentence stays exactly as it was put in by the writer.');
  s.minutes(40).retype('quick brown fox', 'slow red hen', { from: 0 });
  s.minutes(1).del(s.find(' near the old'), ' near the old river bank'.length);
  const r = analyze({ pages: [s.page()], exportText: s.text, startAsProvided: false });
  const a = spanWith(r, 'ALPHA');
  assert(a.orig, 'the revised passage has its original');
  eq(a.orig.text, 'ALPHA the quick brown fox jumps over the lazy dog near the old river bank today.', 'original sentence, deleted words included, nothing from the next sentence');
  eq(a.orig.diff.filter((d) => d.op === 'ins').map((d) => d.text.trim()).join('|'), 'slow red hen', 'added words');
  eq(a.orig.removed, 8, 'removed words: quick brown fox + near the old river bank');
  eq(spanWith(r, 'BRAVO').orig, null, 'an unchanged chunk has nothing to compare');
  const typed = new Synth().type('CHARLIE typed slowly by hand, one key at a time, all the way to the end.');
  typed.minutes(40).retype('slowly', 'carefully', { from: 0 });
  eq(spanWith(analyze({ pages: [typed.page()], exportText: typed.text, startAsProvided: false }), 'CHARLIE').orig, null, 'typed text has no original to show');
  eq(JSON.stringify(diffWords('the cat sat', 'the dog sat')), JSON.stringify([{ op: 'same', text: 'the ' }, { op: 'del', text: 'cat' }, { op: 'ins', text: 'dog' }, { op: 'same', text: ' sat' }]), 'word diff');
});

check('a class pack carries dashboards to a co-teacher and merges on re-import', () => {
  const A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', B = '1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', C = '1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
  const mine = {
    dashboards: [
      { id: 'dash-1', name: 'Period 3 – Science fair', links: `Student 1, https://docs.google.com/document/u/1/d/${A}/edit\nStudent 2\thttps://docs.google.com/document/d/${B}/edit?tab=t.0`, dueAt: 1790000000000, checkpoints: [{ t: 1789000000000, label: 'Proposal' }], review: { [A]: 1, [B]: 0, [C]: 2 }, updated: 1, expires: 9e15 },
      { id: 'dash-2', name: 'Other class', links: `https://docs.google.com/document/d/${C}/edit`, dueAt: null, checkpoints: [], review: {} },
    ],
    docs: { [A]: { dueAt: 1790000000000, checkpoints: [], startAsProvided: false }, [C]: { dueAt: null, checkpoints: [], startAsProvided: true } },
    settings: { roles: { 'tch-1': 'teacher', 'x': 'provided' }, schoolOn: true, schedule: { days: [1, 2, 3, 4, 5], start: '08:00', end: '15:30' } },
  };
  const pack = buildPack(mine, { ids: ['dash-1'] });
  const text = JSON.stringify(pack);
  assert(!text.includes('/u/1/'), 'no account number in links');
  eq(pack.dashboards.length, 1, 'only the chosen dashboard');
  eq(JSON.stringify(Object.keys(pack.docs)), JSON.stringify([A]), 'only its documents’ settings');
  eq(JSON.stringify(pack.dashboards[0].review), JSON.stringify({ [A]: 1 }), 'review marks only for its own documents, unset ones left out');
  const got = readPack(text);
  assert(got.ok, 'reads back');
  // The co-teacher has nothing yet.
  const empty = { dashboards: [], docs: {}, settings: { roles: { 'tch-2': 'teacher' } } };
  const m1 = mergePack(empty, got.pack, { school: true });
  eq(m1.summary.added, 1, 'new dashboard');
  eq(m1.dashboards[0].links.split('\n')[0], `Student 1, https://docs.google.com/document/d/${A}/edit`, 'label and clean link');
  eq(m1.roles['tch-1'], 'teacher', 'your role arrives');
  eq(m1.roles['tch-2'], 'teacher', 'theirs is kept');
  eq(m1.school.schedule.end, '15:30', 'school hours when asked');
  // Later: you add a checkpoint and send a new pack; they had marked Student 2 themselves.
  const theirs = { dashboards: [{ ...m1.dashboards[0], review: { [B]: 2 }, checkpoints: [...m1.dashboards[0].checkpoints, { t: 1789500000000, label: 'Mine' }] }], docs: m1.docs, settings: { roles: m1.roles } };
  mine.dashboards[0].checkpoints.push({ t: 1789900000000, label: 'Data' });
  const m2 = mergePack(theirs, readPack(JSON.stringify(buildPack(mine, { ids: ['dash-1'] }))).pack);
  eq(m2.summary.updated, 1, 'updates, not duplicates');
  eq(m2.dashboards[0].checkpoints.map((c) => c.label).join(','), 'Proposal,Mine,Data', 'checkpoints combined in time order');
  eq(JSON.stringify(m2.dashboards[0].review), JSON.stringify({ [A]: 1, [B]: 2 }), 'their own mark kept, yours added');
  eq(m2.school, null, 'school hours untouched unless asked');
});

check('a class pack from a file is checked field by field', () => {
  const D = '1DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
  eq(readPack('{"not":"a pack"}').error, 'NOT_A_PACK', 'wrong file');
  eq(readPack('oops').error, 'NOT_A_PACK', 'not JSON');
  const evil = JSON.stringify({ schema: 'wh-class-pack-1', dashboards: [{ id: '<img onerror>', name: 7, links: `javascript:alert(1)\nhttps://evil.example/document/d/${D}/edit\nKid, https://docs.google.com/document/d/${D}/edit`, review: { [D]: 9 }, checkpoints: [{ t: 'soon' }, { t: 5, label: 'ok' }] }], docs: { 'bad id': {}, [D]: { dueAt: 'x' } }, roles: { 'a b': 'teacher', u1: 'admin', u2: 'provided' }, school: { schedule: { days: [9], start: '25:00', end: 'x' } } });
  const r = readPack(evil);
  assert(r.ok, 'the usable part is kept');
  const d = r.pack.dashboards[0];
  eq(d.id, null, 'bad id dropped (a new one is made on import)');
  eq(d.name, '', 'non-text name dropped');
  eq(d.links, `Kid, https://docs.google.com/document/d/${D}/edit`, 'only real Google Doc links');
  eq(JSON.stringify(d.review), '{}', 'unknown review value dropped');
  eq(d.checkpoints.length, 1, 'bad checkpoint dropped');
  eq(JSON.stringify(Object.keys(r.pack.docs)), JSON.stringify([D]), 'bad doc id dropped');
  eq(r.pack.docs[D].dueAt, null, 'bad due date dropped');
  eq(JSON.stringify(r.pack.roles), '{"u2":"provided"}', 'only known roles for plain ids');
  eq(r.pack.school, null, 'bad school hours dropped');
  eq(readPack(JSON.stringify({ schema: 'wh-class-pack-1', dashboards: [{ links: 'nothing here' }] })).error, 'EMPTY_PACK', 'no usable dashboards');
});

check('the whole document plays from an empty page to the finished text', () => {
  const s = new Synth({ user: 'student-1' });
  s.type('ALPHA one two three. ');
  s.minutes(40).insert(`BRAVO ${lorem(30, 2)}. `);
  s.minutes(5).retype('two', 'TWO', { from: 0 });
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const rp = new Replayer(r._events);
  const w = rp.full('');
  eq(w.windows.length, 1, 'one window');
  eq(w.windows[0].startText, '', 'starts empty');
  const end = w.windows[0].steps.reduce((t, st) => applyToText(t, st), '');
  eq(end, s.text, 'ends as the document');
});

check('a long passage replays every edit behind it, not just the first 200', () => {
  const s = new Synth({ user: 'student-1' });
  s.type(`ALPHA ${lorem(200, 3)}.`); // typed in small batches: hundreds of edits
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const sp = spanWith(r, 'ALPHA');
  assert(sp.eventsTotal > 300, `many edits (${sp.eventsTotal})`);
  eq(sp.events.length, 200, 'the edit list stays capped');
  eq(expandRuns(sp.runs).length, sp.eventsTotal, 'the runs hold them all');
  const w = new Replayer(r._events).window('', expandRuns(sp.runs), 400000);
  const steps = w.windows.reduce((n, x) => n + x.steps.length, 0);
  assert(steps >= sp.eventsTotal, `replay has every edit (${steps})`);
});

check('the writing timeline places each student’s sessions on one shared scale', () => {
  const T = (d, hr) => new Date(2026, 9, d, hr).getTime();
  const s = new Synth({ user: 'stu-1', start: T(5, 9) });
  s.insert('Report\nIntro:\n');
  s.as('stu-1').minutes(5).type(` ${lorem(30, 1)}.`, { at: s.find('Intro:') + 6 });
  s.as('stu-2').wait(T(8, 21) - s.t).insert(` ${lorem(40, 2)}.`, s.text.length - 1);
  s.as('stu-2').minutes(20).type(` ${lorem(10, 3)}.`, { at: s.text.length - 1 });
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const eds = r.contributions.editors.filter((e) => e.role === 'student');
  const m = timelineModel(eds, { dueAt: T(9, 8), checkpoints: [{ t: T(7, 12), label: 'Draft' }] });
  const one = m.rows.get('student:stu-1'), two = m.rows.get('student:stu-2');
  assert(one.blocks[0].x0 < 0.1 && two.blocks[0].x0 > 0.7, 'student 1 early, student 2 late');
  assert(m.due > two.blocks[0].x1 && m.due < 1, 'due date after the last edit, inside the strip');
  eq(m.days.length, 4, 'a tick at each midnight from Oct 6 to Oct 9');
  eq(two.chunks.length, 1, 'one large chunk marked');
  eq(one.lastDay, 0, 'student 1 wrote nothing in the last day');
  eq(two.lastDay, 1, 'student 2 wrote everything in the last day');
  eq(m.checkpoints[0].label, 'Draft', 'checkpoint marked');
  eq(timelineModel([]), null, 'nothing to draw');
});

check('a draft copied into the final section is counted as copied, not as a large chunk', () => {
  const s = new Synth({ user: 'stu-1' });
  s.insert('Rough draft:\nFinal draft:\n');
  const para = `${lorem(45, 7)}.`;
  s.minutes(5).type(` ${para}`, { at: s.find('Rough draft:') + 12 });
  s.minutes(60).insert(` ${para}`, s.text.length - 1);
  s.minutes(5).retype(para.slice(20, 40), 'some better words here', { from: s.find('Final draft:') });
  const r = analyze({ pages: [s.page()], exportText: s.text });
  const fin = r.tabs[0].spans.filter((sp) => sp.owner === 'student:stu-1' && sp.start > r.tabs[0].text.indexOf('Final draft:'));
  assert(fin.length && fin.every((sp) => sp.cat !== CAT.LARGE), 'not red: it keeps the draft’s history');
  assert(fin.some((sp) => sp.badges.includes('moved')), 'marked as copied');
  const e = r.contributions.editors.find((x) => x.role === 'student');
  eq(e.chunks, 0, 'no large chunks');
  eq(e.copies, 1, 'one copy within the Doc');
  assert(e.copied > 200 && e.copiedWords > 30, `copied counted (${e.copied} chars, ${e.copiedWords} words)`);
  eq(e.chunkTimes.length, 0, 'no red mark on the timeline');
});

check('text copied from one Docs tab into another is recognised as a copy', () => {
  const text = 'This paragraph was drafted in the first tab and copied over to the second one.';
  const evs = [
    makeEvent({ i: 0, t: 1000, actor: 'a', op: EOP.INS, pos: 0, text, tab: '' }),
    makeEvent({ i: 1, t: 999999, actor: 'a', op: EOP.INS, pos: 0, text, tab: 't.1' }),
  ];
  const lin = buildLineage(evs);
  assert(lin.internal.has(1), 'the second tab’s insertion came from the first');
  eq(lin.stats.copies, 1, 'one copy');
});

console.log('\nClass dashboard');

check('pasted links are read with or without a name, duplicates dropped', () => {
  const id1 = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd', id2 = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210zyxw';
  const got = parseLinks(`Student 1, https://docs.google.com/document/d/${id1}/edit?usp=sharing\nhttps://docs.google.com/document/u/1/d/${id2}/edit\n\nnot a link\nStudent 1 again\thttps://docs.google.com/document/d/${id1}/edit`);
  eq(got.length, 2, 'two documents');
  eq(got[0].label, 'Student 1', 'name before the link');
  eq(got[1].label, '', 'no name');
  eq(got[1].u, 1, 'account index kept');
});

function scienceFair(seed, user) {
  const s = new Synth({ user });
  s.insert('Science Fair Project\nQuestion:\nHypothesis:\nProcedure:\nResults:\n');
  s.style(0, 21, 'paragraph', { ps_hd: 1 });
  for (const t of ['Question:', 'Hypothesis:', 'Procedure:', 'Results:']) s.style(s.find(t), t.length + 1, 'paragraph', { ps_hd: 2 });
  s.minutes(5).type(` ${lorem(10 + seed, seed)}.`, { at: s.find('Hypothesis:') + 'Hypothesis:'.length });
  s.minutes(5).insert(` ${lorem(30, seed + 1)}.`, s.find('Procedure:') + 'Procedure:'.length);
  return analyze({ pages: [s.page()], exportText: s.text });
}

function plainTemplate(seed, user, template = 'Science Fair Project\nQuestion:\nHypothesis:\nProcedure:\nResults:\n') {
  const s = new Synth({ user });
  s.insert(template); // no Heading styles: bold or plain lines in the template
  const first = template.split('\n')[2];
  s.minutes(5).type(` ${lorem(10 + seed, seed)}.`, { at: s.find(first) + first.length });
  return analyze({ pages: [s.page()], exportText: s.text });
}

check('a Doc with no headings falls back to its template lines for sections', () => {
  const r = plainTemplate(1, 'student-1');
  eq(r.tabs[0].sectionsFrom, 'template', 'fell back');
  eq(r.tabs[0].sections.map((x) => x.key).join(' | '), 'science fair project | question | hypothesis | procedure | results', 'template lines');
  eq(scienceFair(1, 'student-1').tabs[0].sectionsFrom, 'headings', 'a Doc with headings keeps them');
});

check('headings are read from Google’s HTML copy when the history has no heading styles', () => {
  const html = '<html><head><style>h2{color:red}</style></head><body class="c5 doc-content"><p class="c3 title" id="h.t"><span class="c4">Science Fair Project</span></p>'
    + '<h2 class="c2" id="h.q"><span class="c0">Question:</span></h2><p class="c1"><span>Plain line</span></p><h3 id="h.r"><span>R&amp;D &#8211; notes</span></h3></body></html>';
  eq(JSON.stringify(headingsFromHtml(html).map(({ level, text }) => ({ level, text }))), JSON.stringify([{ level: 100, text: 'science fair project' }, { level: 2, text: 'question:' }, { level: 3, text: 'r&d – notes' }]), 'title and headings, entities decoded');
  const s = new Synth({ user: 'student-1' });
  s.insert('Science Fair Project\nQuestion:\nHypothesis:\nProcedure:\nResults:\nNotes for the teacher only here\n');
  s.minutes(5).type(` ${lorem(12, 3)}.`, { at: s.find('Hypothesis:') + 'Hypothesis:'.length });
  const lines = s.text.split('\n');
  const doc = `<body><p class="c1 title"><span>${lines[0]}</span></p>${lines.slice(1, 5).map((l) => `<h2><span>${l}</span></h2>`).join('')}<p class="c2"><span>${lines[5]}</span></p></body>`;
  const r = analyze({ pages: [s.page()], exportText: s.text, exportHtml: doc });
  eq(r.tabs[0].sectionsFrom, 'headings', 'headings found');
  eq(r.tabs[0].sections.map((x) => x.key).join(' | '), 'question | hypothesis | procedure | results', 'only the Heading 2 lines, not the title or the plain line');
  eq(r.diagnostics.htmlHeadings.matched, 5, 'title and four headings matched');
});

check('a table of contents is not taken for the headings it lists', () => {
  const toc = ['Question', 'Hypothesis', 'Procedure', 'Results'];
  const body = toc.map((t) => `${t}\nStudent writing for ${t.toLowerCase()} goes here`).join('\n');
  const tocHtml = toc.map((t) => `<p class="c2"><span class="c1"><a class="c3" href="#h.${t}">${t}</a></span></p>`).join('');
  const html = `<body>${tocHtml}${toc.map((t) => `<h2 id="h.${t}"><span>${t}</span></h2><p><span>Student writing for ${t.toLowerCase()} goes here</span></p>`).join('')}</body>`;
  for (const withToc of [true, false]) {
    const s = new Synth({ user: 'student-1' });
    s.insert(`${withToc ? `${toc.join('\n')}\n` : ''}${body}\n`);
    s.minutes(5).type(` ${lorem(12, 3)}.`, { at: s.find('for results goes here') + 'for results goes here'.length });
    const r = analyze({ pages: [s.page()], exportText: s.text, exportHtml: html });
    const secs = r.tabs[0].sections;
    eq(secs.map((x) => x.key).join(' | '), 'question | hypothesis | procedure | results', `four sections (${withToc ? 'Doc text holds the contents list' : 'it does not'})`);
    const text = r.tabs[0].text;
    for (const sec of secs) eq(text.slice(sec.start, sec.end).includes(`for ${sec.key} goes here`), true, `${sec.key} runs to its own writing`);
    eq(secs[3].end >= text.trimEnd().length, true, 'last section runs to the end, typed answer included');
  }
});

check('headings with dashes and quotes in Google’s copy are found, and a repeated heading is told apart', () => {
  const lines = ['Step 1 — Pick a Topic (Due: Sept. 18)', 'Type your topic', 'Step 2 — “Research” (Due: Oct. 2)', 'Type your notes',
    'Write-Up: Report (Due: Nov. 13)', 'Conclusion', 'Type your conclusion', 'Write-Up: Board (Due: Nov. 24)', 'Conclusion', 'Type a short conclusion'];
  const level = { 0: 2, 2: 2, 4: 1, 5: 2, 7: 1, 8: 2 };
  const enc = (t) => t.replace(/&/g, '&amp;').replace(/—/g, '&mdash;').replace(/“/g, '&ldquo;').replace(/”/g, '&rdquo;');
  const html = `<body>${lines.map((l, k) => (level[k] ? `<h${level[k]}><span>${enc(l)}</span></h${level[k]}>` : `<p><span>${enc(l)}</span></p>`)).join('')}</body>`;
  const s = new Synth({ user: 'student-1' });
  s.insert(`${lines.join('\n')}\n`);
  s.minutes(5).type(` ${lorem(12, 4)}.`, { at: s.find('Type a short conclusion') + 'Type a short conclusion'.length });
  const r = analyze({ pages: [s.page()], exportText: s.text, exportHtml: html });
  eq(r.diagnostics.htmlHeadings.matched, 6, 'every heading matched');
  const secs = r.tabs[0].sections;
  eq(secs.map((x) => x.label).join(' | '), 'Step 1 — Pick a Topic (Due: Sept. 18) | Step 2 — “Research” (Due: Oct. 2) | Write-Up: Report (Due: Nov. 13) | Conclusion (Write-Up: Report) | Write-Up: Board (Due: Nov. 24) | Conclusion (Write-Up: Board)', 'labels');
  eq(new Set(secs.map((x) => x.key)).size, secs.length, 'every section has its own key');
  const board = secs[5];
  eq(r.tabs[0].text.slice(board.start, board.end).includes('Type a short conclusion'), true, 'the second Conclusion is the board’s');
});

check('a heading’s section includes the smaller headings under it', () => {
  const s = new Synth({ user: 'student-1' });
  s.insert('Procedure\nMaterials\nSalt and water\nSteps\nBoil it\nResults\nIt boiled\n');
  s.style(s.find('Procedure'), 10, 'paragraph', { ps_hd: 1 });
  s.style(s.find('Materials'), 10, 'paragraph', { ps_hd: 2 });
  s.style(s.find('Steps'), 6, 'paragraph', { ps_hd: 2 });
  s.style(s.find('Results'), 8, 'paragraph', { ps_hd: 1 });
  const secs = analyze({ pages: [s.page()], exportText: s.text }).tabs[0].sections;
  const span = (k) => { const x = secs.find((y) => y.key === k); return `${x.para}-${x.endPara}`; };
  eq(span('procedure'), '0-5', 'Procedure runs through Materials and Steps');
  eq(span('materials'), '1-3', 'Materials stops at Steps');
  eq(span('steps'), '3-5', 'Steps stops at Results');
  eq(span('results'), '5-7', 'Results runs to the end');
});

check('an earlier moment finds its headings even after their text changed', () => {
  const s = new Synth({ user: 'student-1' });
  s.insert('Question:\nHypothesis:\nProcedure:\n');
  const before = s.t + 1;
  s.minutes(30).type(` ${lorem(12, 4)}.`, { at: s.find('Hypothesis:') + 'Hypothesis:'.length });
  const html = `<body>${s.text.split('\n').filter(Boolean).map((l) => `<h2><span>${l}</span></h2>`).join('')}</body>`;
  const full = analyze({ pages: [s.page()], exportText: s.text, exportHtml: html });
  eq(full.tabs[0].sections.length, 3, 'now: three headings');
  const then = analyze({ pages: [s.page()], exportText: s.text, exportHtml: html, asOf: before, deleteInclusive: full.diagnostics.deleteInclusive, headingMarks: full.headingMarks });
  eq(then.tabs[0].sectionsFrom, 'headings', 'then: still headings, not template lines');
  eq(then.tabs[0].sections.map((x) => x.key).join(' | '), 'question | hypothesis | procedure', 'then: same three');
});

check('the class list keeps the sections most documents share', () => {
  const docs = [1, 2, 3, 4].map((k) => ({ id: `d${k}`, result: plainTemplate(k, `student-${k}`) }));
  docs.push({ id: 'wrong', result: plainTemplate(5, 'student-5', 'Volcano Report\nIntroduction to volcanoes\nTypes of eruptions\n') });
  const m = majoritySections(docs);
  eq(m.shown.map((x) => x.key).join(' | '), 'science fair project | question | hypothesis | procedure | results', 'majority only');
  eq(m.hidden, 3, 'the wrong document’s three sections are offered, not listed');
  eq(majoritySections(docs, true).shown.length, 8, 'show all');
  eq(majoritySections(docs.slice(0, 1).concat(docs.slice(4))).shown.length, 8, 'with two documents, everything is listed');
});

check('the same section is found in every copy, even with answers typed on the heading line', () => {
  const docs = [1, 2, 3].map((k) => ({ id: `d${k}`, result: scienceFair(k, `student-${k}`) }));
  const secs = commonSections(docs);
  eq(secs.map((x) => x.key).join(' | '), 'science fair project | question | hypothesis | procedure | results', 'keys in order');
  assert(secs.every((x) => x.count === 3), 'in all three');
  const slice = sliceSection(docs[1].result.tabs[0], 'hypothesis');
  assert(slice.spans.length > 0 && slice.spans.every((sp) => sp.para === slice.section.para), 'only the hypothesis paragraph');
  eq(slice.studentWords, 12, 'student words in the section');
});

check('each document gives one dashboard row of numbers', () => {
  const m = rowMetrics(scienceFair(1, 'student-1'));
  eq(m.students, 1, 'one student');
  assert(m.typed > 0 && m.chunked > 0, 'typed and chunked');
  near(m.composed + m.revised + m.large + (m.shares.mixed || 0) + (m.shares.unclear || 0), 1, 'shares add up', 1e-9);
  eq(toCsv([['a,b', 'say "hi"'], [1, null]]), '"a,b","say ""hi"""\n1,', 'csv quoting');
});

console.log('\nWho wrote what');

function groupDoc() {
  const s = new Synth({ user: 'teacher-1' }).preexisting('Prompt from the template that every group starts with.\n');
  s.type('ALPHA Teacher instructions typed into the document for the group.\n');
  s.as('student-1').minutes(5).type('BRAVO The first student writes this whole sentence by hand.\n');
  s.as('student-2').minutes(1).insert('CHARLIE The second student brings this paragraph in all at once and it is long.\n');
  s.as('student-1').minutes(1).del(s.find('Prompt'), 'Prompt from the template that every group starts with.'.length);
  s.as('student-2').type('DELTA Second student types a closing line.');
  return s;
}

check('provided, teacher and each student’s text are told apart', () => {
  const s = groupDoc();
  const r = analyze({ pages: [s.page()], exportText: s.text, roles: { 'teacher-1': 'teacher' } });
  eq(spanWith(r, 'ALPHA').cat, CAT.TEACHER, 'teacher text set aside');
  eq(spanWith(r, 'BRAVO').cat, CAT.LINEAR, 'student 1 typed');
  eq(spanWith(r, 'CHARLIE').cat, CAT.LARGE, 'student 2 inserted');
  eq(spanWith(r, 'BRAVO').owner, 'student:student-1', 'owner');
  const c = r.contributions;
  const e1 = c.editors.find((e) => e.id === 'student-1'), e2 = c.editors.find((e) => e.id === 'student-2');
  const tch = c.editors.find((e) => e.id === 'teacher-1');
  eq(tch.role, 'teacher', 'teacher role');
  eq(tch.share, null, 'teacher counted in the teacher bucket, not per person');
  assert(c.teacher.finalChars > 0 && c.provided.finalChars === 0, 'buckets: provided text was deleted');
  eq(e1.removedProvided, 'Prompt from the template that every group starts with.'.replace(/\s/g, '').length, 'student 1 removed the prompt');
  near(e1.share + e2.share + c.teacher.share, 1, 'shares add up');
  assert(e2.share > e1.share, 'student 2 has more of the final text');
  eq(e1.words, 10, 'student 1 words');
  eq(e2.chunks, 1, 'student 2 added one large chunk');
  eq(e2.chunked, 'CHARLIE The second student brings this paragraph in all at once and it is long.\n'.length, 'chunked characters');
  eq(e1.chunked, 0, 'student 1 typed everything');
  assert(e1.typed > 50, 'student 1 typed characters counted');
  eq(e2.catWords.large, 15, 'student 2: 15 words arrived in a large chunk');
  near(e2.cats.large + e2.cats.linear, 1, 'student 2 shares add up');
  // Shares in the summary cover students' text only.
  near(Object.values(r.summary.shares).reduce((a, b) => a + b, 0), 1, 'student shares sum to 1');
  eq(r.summary.shares.teacher, 0, 'teacher text is not in the student shares');
});

check('the signed-in account is recognised as the teacher without being marked', () => {
  const s = groupDoc();
  const r = analyze({ pages: [s.page()], exportText: s.text, selfId: 'teacher-1' });
  eq(spanWith(r, 'ALPHA').cat, CAT.TEACHER, 'self = teacher');
  assert(r.actors.find((a) => a.id === 'teacher-1').isSelf, 'flagged');
});

check('an editor marked Provided is set aside like template text', () => {
  const s = groupDoc();
  const r = analyze({ pages: [s.page()], exportText: s.text, roles: { 'teacher-1': 'provided' } });
  eq(spanWith(r, 'ALPHA').cat, CAT.PROVIDED, 'provided');
});

check('a sentence half teacher, half student splits at the change of writer', () => {
  const s = new Synth({ user: 'teacher-1' }).type('Complete this sentence about the water cycle: ');
  s.as('student-1').minutes(2).type('evaporation turns water into vapour that rises.');
  const r = analyze({ pages: [s.page()], exportText: s.text, roles: { 'teacher-1': 'teacher' } });
  eq(spanWith(r, 'Complete this').cat, CAT.TEACHER, 'teacher half');
  eq(spanWith(r, 'evaporation').cat, CAT.LINEAR, 'student half');
});

check('a document that starts as a template copy: the starting text is provided, not the student’s', () => {
  const s = new Synth({ user: 'student-1' });
  s.insert('Template: Name ____\nQuestion 1: Explain photosynthesis in your own words.\nQuestion 2: Draw a diagram.\n');
  s.minutes(10).type('ALPHA My answer typed by the student about how plants make food.', { at: s.find('Question 2') });
  const r = analyze({ pages: [s.page()], exportText: s.text });
  eq(spanWith(r, 'Explain photosynthesis').cat, CAT.PROVIDED, 'template is provided');
  eq(spanWith(r, 'ALPHA').cat, CAT.LINEAR, 'student answer typed');
  assert(r.banners.includes('startProvided'), 'banner explains it');
  eq(r.summary.shares.large, 0, 'the template is not a large insertion in the student bars');
  const e = r.contributions.editors.find((x) => x.id === 'student-1');
  eq(e.cats.large, undefined, 'nor in the student’s own breakdown');
  const r2 = analyze({ pages: [s.page()], exportText: s.text, startAsProvided: false });
  eq(spanWith(r2, 'Explain photosynthesis').cat, CAT.LARGE, 'the teacher can count it as the student’s');
  assert(r2.banners.includes('startStudent'), 'and the banner says so');
});

check('a first edit that is just typing is not treated as a template', () => {
  const s = new Synth().type('ALPHA typed from the very first keystroke onwards.');
  const r = analyze({ pages: [s.page()], exportText: s.text });
  eq(spanWith(r, 'ALPHA').cat, CAT.LINEAR, 'typed');
  assert(!r.banners.includes('startProvided'), 'no banner');
});

console.log('\nComparison and storage');

check('half a paragraph is not a match', () => {
  const c = compareText(['Procedure:', 'Results:'], 'Procedure: we heated the water\nResults:');
  assert(c.status !== 'exact' && c.mismatched.has(0) && !c.mismatched.has(1), 'the cut-short paragraph is flagged');
  const t = compareText(['Trial', 'Time (s)', 'Plain water', '312'], 'Trial\tTime (s)\nPlain water\t312');
  eq(t.status, 'exact', 'table cells joined on one line still match');
});

check('mismatched paragraphs are flagged, matching ones are not', () => {
  const c = compareText(['one line', 'two line', 'three'], 'one line\r\n• two line\nsomething else');
  eq(c.status, 'mismatch', 'status');
  assert(!c.mismatched.has(0) && !c.mismatched.has(1) && c.mismatched.has(2), 'which');
});

check('a rebuild that disagrees with Google’s text shows those paragraphs as unclear', () => {
  const s = new Synth().type('First paragraph typed.\nSecond paragraph typed.');
  const r = analyze({ pages: [s.page()], exportText: 'First paragraph typed.\nSomething different.' });
  eq(spanWith(r, 'Second paragraph').cat, CAT.UNCLEAR, 'unclear');
  eq(spanWith(r, 'First paragraph').cat, CAT.LINEAR, 'matching paragraph keeps its colour');
});

check('cache entries expire on time', () => {
  const now = 1_000_000;
  const items = { 'cache:a': { expires: expiresAt(now, 60) }, 'note:b': { expires: now - 1 }, 'settings': { ttl: 60 } };
  eq(expiredKeys(items, now).join(), 'note:b', 'expired');
  eq(expiredKeys(items, now + 61 * 60000).sort().join(), 'cache:a,note:b', 'later');
});

console.log('\nGuards');

function filesUnder(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p)); else out.push(p);
  }
  return out;
}
const extFiles = filesUnder(join(ROOT, 'extension'));
const code = (p) => readFileSync(p, 'utf8');

check('the extension asks only for storage and a side panel, and only for Google Docs documents and Slides decks', () => {
  const m = JSON.parse(code(join(ROOT, 'extension/manifest.json')));
  const files = '["https://docs.google.com/document/*","https://docs.google.com/presentation/*"]';
  eq(JSON.stringify(m.permissions), '["storage","sidePanel"]', 'permissions: storage and the side panel only');
  eq(JSON.stringify(m.host_permissions || []), files, 'host permissions: Docs documents and Slides decks only');
  assert(m.content_scripts.every((c) => JSON.stringify(c.matches) === files), 'content script: Docs and Slides only');
});

check('only two files make network requests, and both are fenced to Google Docs', () => {
  const allowed = [join('content', 'docs.js'), join('viewer', 'net.js')];
  for (const f of extFiles.filter((p) => p.endsWith('.js'))) {
    const src = code(f);
    if (/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src)) assert(allowed.some((a) => f.endsWith(a)), `${f} makes a request`);
  }
  assert(/if \(!allowed\(url\)\) return/.test(code(join(ROOT, 'extension/viewer/net.js'))), 'net.js checks every URL');
  assert(/if \(!allowed\(url\)\) return/.test(code(join(ROOT, 'extension/content/docs.js'))), 'docs.js checks every URL');
});

check('no URL in the extension points anywhere but Google Docs', () => {
  for (const f of extFiles.filter((p) => /\.(js|html|css|json)$/.test(p))) {
    for (const m of code(f).matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      assert(/^https:\/\/docs\.google\.com(\/|$)/.test(m[0]) || /^https?:\/\/www\.w3\.org\//.test(m[0]), `${f}: ${m[0]}`);
    }
  }
});

check('the viewer never writes HTML from strings', () => {
  for (const f of extFiles.filter((p) => p.includes(`${join('extension', 'viewer')}`) && p.endsWith('.js'))) {
    assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code(f)), `${f} writes HTML`);
  }
});

check('the wording describes, never judges', () => {
  const src = code(join(ROOT, 'extension/lib/wording.js')) + code(join(ROOT, 'extension/lib/report.js'));
  const banned = /\b(AI|cheat\w*|authentic\w*|suspicious|suspect\w*|risk\w*|score\w*|likely|honest\w*|plagiari\w*|guilt\w*)\b/i;
  const hit = src.match(banned);
  assert(!hit, `found "${hit && hit[0]}"`);
});

check('scrubbing a raw download removes ids, names and tokens', () => {
  const s = new Synth({ user: '112233445566778899001' }).type('Fixture text ALPHA here.');
  const raw = {
    fixtureName: 'typed', capturedAt: '2026-10-03T10:00:00Z', variant: 'B', lastRev: s.log.length,
    tiles: `)]}'\n${JSON.stringify({ tileInfo: [{ start: 1, end: s.log.length, revisionMac: 'x' }], firstRev: 1, userMap: { 112233445566778899001: { name: 'Real Person', email: 'person@school.example.org', photo: 'https://lh3.googleusercontent.com/x' } } })}`,
    pages: [s.page()], exportText: s.text, snapshot: null,
  };
  assert(checkFixtureText(JSON.stringify(raw)).length > 0, 'the raw download is caught');
  const f = scrub(raw);
  eq(checkFixtureText(JSON.stringify(f)).join(), '', 'scrubbed is clean');
  const r = analyze({ pages: f.pages, exportText: f.exportText, tilesBody: f.tiles });
  eq(r.summary.completeness, 'verified', 'still analyses');
});

// Real histories captured from test documents (docs/fixtures.md). Each must
// rebuild to Google's text, and each marker word must land in its category.
const FIX = join(ROOT, 'fixtures');
for (const name of existsSync(FIX) ? readdirSync(FIX).filter((f) => existsSync(join(FIX, f, 'expect.json'))) : []) {
  check(`fixture ${name} rebuilds and classifies as expected`, () => {
    const f = JSON.parse(code(join(FIX, name, 'raw.json')));
    const expect = JSON.parse(code(join(FIX, name, 'expect.json')));
    const r = analyze({ pages: f.pages, exportText: f.exportText, snapshotBody: f.snapshot, tilesBody: f.tiles });
    if (expect.completeness) eq(r.summary.completeness, expect.completeness, 'completeness');
    for (const [marker, cat] of Object.entries(expect.markers || {})) eq(spanWith(r, marker).cat, cat, marker);
  });
}

check('committed fixtures carry no personal data', () => {
  const dir = join(ROOT, 'fixtures');
  if (!existsSync(dir)) return;
  for (const f of filesUnder(dir)) {
    const problems = checkFixtureText(code(f));
    assert(!problems.length, `${f}: ${problems.join(', ')}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
