// Tests. Each one is a claim Writing Heatmap makes about itself; if one fails,
// that claim is no longer true. Run: npm test

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripXssi, parsePages, flatten, diagnostics } from '../extension/lib/gdocs/parse.js';
import { normalize } from '../extension/lib/gdocs/normalize.js';
import { parseDocUrl, findInfoParams, loadUrl, VARIANTS } from '../extension/lib/gdocs/endpoints.js';
import { displayText } from '../extension/lib/gdocs/kixtext.js';
import { buildLineage, tabText } from '../extension/lib/lineage.js';
import { segment } from '../extension/lib/segment.js';
import { passageMetrics, timing } from '../extension/lib/metrics.js';
import { classify, THRESHOLDS, CAT } from '../extension/lib/classify.js';
import { compareText } from '../extension/lib/compare.js';
import { analyze } from '../extension/lib/analyze.js';
import { Replayer } from '../extension/lib/replay.js';
import { expiredKeys, expiresAt } from '../extension/lib/ttl.js';
import { checkFixtureText } from './check-fixtures.js';
import { scrub } from './scrub-fixture.js';
import { Synth, lorem } from '../tests/synth.js';

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

console.log('\nComparison and storage');

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

check('the extension asks only for storage, with no extra host permissions', () => {
  const m = JSON.parse(code(join(ROOT, 'extension/manifest.json')));
  eq(JSON.stringify(m.permissions), '["storage"]', 'permissions');
  assert(!m.host_permissions || m.host_permissions.length === 0, 'no host permissions');
  assert(m.content_scripts.every((c) => c.matches.every((x) => x === 'https://docs.google.com/document/*')), 'docs only');
});

check('only the Docs content script makes network requests', () => {
  for (const f of extFiles.filter((p) => p.endsWith('.js'))) {
    const src = code(f);
    if (/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src)) assert(f.endsWith(join('content', 'docs.js')), `${f} makes a request`);
  }
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
