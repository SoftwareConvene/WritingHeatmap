// The class dashboard: many documents at once, from pasted links. Each
// history is read with the teacher's own sign-in (directly, or through a
// background tab that closes again), analyzed here, and kept in memory only.
// Saved in this browser: the dashboard's name, links, due date, checkpoints
// and review marks. Never saved: any document text or analysis.

import { h, clear, fmtTime } from './dom.js';
import { DocFetcher, loadHistory } from './fetcher.js';
import { directGet, directContext, withBackgroundTab } from './net.js';
import { parseLinks, rowMetrics, majoritySections, sliceSection, toCsv, studentNames, docLink } from '../lib/classroom.js';
import { renderDoc, renderLegend } from './render.js';
import { pct, duration } from '../lib/report.js';
import { CATEGORY_TEXT } from '../lib/wording.js';
import { STUDENT_CATS } from '../lib/classify.js';
import { expiresAt } from '../lib/ttl.js';
import { DEFAULT_SETTINGS, getDocPrefs, scheduleOf, toLocalInput, applyPalette, renderSetupNudge } from './prefs.js';
import { buildPack, readPack, mergePack } from '../lib/pack.js';

const $ = (id) => document.getElementById(id);
const DASH_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const CACHE_MAX_CHARS = 8_000_000;
const PARALLEL = 2;
const REVIEW = ['Not reviewed', 'Reviewed', 'Discussed with student'];
const COLOR_VAR = { linear: '--c-linear', light: '--c-light', heavy: '--c-heavy', large: '--c-large', pasted: '--c-pasted', unclear: '--c-unclear', mixed: '--c-mixed' };

let settings = structuredClone(DEFAULT_SETTINGS);
let dash = null;        // the saved dashboard
let docs = [];          // [{ docId, u, label, title, state, error, raw, result, row }]
let stopped = false;
let sort = { key: 'label', dir: 1 };
let page = 'table';
const secView = { colorBy: 'process', focus: '', keys: [], picked: false, current: 0, asOf: null, asOfLabel: '', quick: true, open: new Set(), sort: 'list' };
let cpCache = new Map(); // `${docId}@${t}` -> result
const WHOLE = '*';     // secView.keys entry: the whole document, not one section
// Comments being written in the section view, kept in memory only:
// `${docId}|${keys}` -> { text, quote, open, copied, sent }.
const notes = new Map();
let focusNote = null;
const MAC = /Mac/i.test(navigator.platform);

// ---------- worker ----------
const worker = new Worker('worker.js', { type: 'module' });
let nextId = 1;
const waiting = new Map();
worker.onmessage = (e) => {
  const w = waiting.get(e.data.id);
  if (!w) return;
  waiting.delete(e.data.id);
  if (e.data.ok) w.resolve(e.data.result); else w.reject(Object.assign(new Error(e.data.message), { code: e.data.code }));
};
worker.onerror = () => { for (const w of waiting.values()) w.reject(Object.assign(new Error('crashed'), { code: 'ANALYSIS_CRASHED' })); waiting.clear(); };
const analyze = (input) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, { resolve, reject });
  worker.postMessage({ id, type: 'analyze', input, light: true, slim: true });
});

// ---------- storage ----------
async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = { ...structuredClone(DEFAULT_SETTINGS), ...(s || {}) };
  applyPalette(settings);
  renderSetupNudge($('setup-nudge'), settings);
}
// A color change made in the viewer's Settings shows here straight away.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.settings) return;
  applyPalette(ch.settings.newValue);
  renderSetupNudge($('setup-nudge'), ch.settings.newValue);
});
async function listDashes() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all).filter(([k, v]) => k.startsWith('dash:') && v && v.expires > Date.now()).map(([, v]) => v).sort((a, b) => b.updated - a.updated);
}
async function saveDash() {
  dash.updated = Date.now();
  dash.expires = Date.now() + DASH_TTL_MS;
  await chrome.storage.local.set({ [`dash:${dash.id}`]: dash });
}
function newDash() {
  return { id: crypto.randomUUID(), name: '', links: '', dueAt: null, checkpoints: [], review: {}, updated: Date.now(), expires: Date.now() + DASH_TTL_MS };
}
async function writeCache(docId, lastRev, raw) {
  const entry = { expires: expiresAt(Date.now(), settings.ttlMin), lastRev, raw };
  if (JSON.stringify(entry).length > CACHE_MAX_CHARS) return;
  try { await chrome.storage.session.set({ [`cache:${docId}`]: entry }); } catch { /* over quota */ }
}
async function readCache(docId) {
  const got = (await chrome.storage.session.get(`cache:${docId}`))[`cache:${docId}`];
  return got && got.expires > Date.now() ? got : null;
}

// ---------- loading one document ----------
async function inputFor(doc) {
  const prefs = await getDocPrefs(doc.docId);
  return {
    pages: doc.raw.pages, exportText: doc.raw.exportText, exportHtml: doc.raw.exportHtml, snapshotBody: doc.raw.snapshotBody, tilesBody: doc.raw.tilesBody,
    roles: settings.roles || {}, selfId: doc.ouid, startAsProvided: prefs.startAsProvided !== false,
    schedule: scheduleOf(settings), dueAt: dash.dueAt || null, headingsOnly: settings.headingsOnly !== false,
  };
}

async function loadDoc(doc) {
  doc.state = 'Loading…';
  drawTable();
  try {
    const cached = await readCache(doc.docId);
    let got = null;
    const ctx = await directContext(doc.docId, doc.u);
    if (ctx.ok) {
      try { got = { ctx, ...(await loadHistory(new DocFetcher(directGet, ctx, settings.variant), () => {}, cached)) }; } catch { got = null; }
    }
    if (!got) {
      doc.state = 'Opening in the background…';
      drawTable();
      const bg = await withBackgroundTab(doc.docId, doc.u, async (tabId, c) => ({ ok: true, ctx: c, ...(await loadHistory(new DocFetcher(tabId, c, settings.variant), () => {}, cached)) }));
      if (!bg.ok) throw Object.assign(new Error('no access'), { code: 'NO_ACCESS' });
      got = bg;
    }
    doc.title = got.ctx.title || '';
    doc.ouid = got.ctx.ouid;
    doc.raw = got.raw;
    if (!got.info.cached) writeCache(doc.docId, got.info.last, got.raw);
    doc.state = 'Analyzing…';
    drawTable();
    doc.result = await analyze(await inputFor(doc));
    doc.row = rowMetrics(doc.result);
    doc.state = 'done';
  } catch (err) {
    doc.state = 'error';
    doc.error = err.code === 'NO_ACCESS' ? 'No edit access' : 'Could not load';
  }
  nameRows();
  drawTable();
}

// Rows the teacher did not label take the student's name from the Doc once
// it is read. Names are only kept while this page is open, never saved.
function nameRows() {
  const names = studentNames(docs);
  for (const d of docs) if (d.auto) d.label = names.get(d.docId) || `Student ${d.n}`;
}

async function runAll() {
  await loadSettings(); // a change made in the viewer's Settings applies from the next run
  dash.links = $('dash-links').value;
  dash.name = $('dash-name').value.trim();
  await saveDash();
  await refreshPicker();
  const items = parseLinks(dash.links);
  if (!items.length) { status('Paste at least one Google Doc link.'); return; }
  docs = items.map((it, k) => ({ ...it, label: it.label || `Student ${k + 1}`, auto: !it.label, n: k + 1, title: '', state: 'Waiting', raw: null, result: null, row: null }));
  cpCache = new Map();
  inflight = new Map();
  cpFailed = new Set();
  stopped = false;
  $('dash-run').disabled = true;
  $('dash-stop').hidden = false;
  drawTable();
  let next = 0;
  const lane = async () => {
    while (!stopped && next < docs.length) {
      const doc = docs[next++];
      await loadDoc(doc);
      status(`${docs.filter((d) => d.state === 'done' || d.state === 'error').length} of ${docs.length} documents done`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, lane));
  $('dash-run').disabled = false;
  $('dash-stop').hidden = true;
  status(stopped ? 'Stopped.' : `All ${docs.length} documents done.`);
  drawAll();
}

function status(text) { $('dash-status').textContent = text; }

// ---------- class table ----------
const COLS = [
  { key: 'label', label: 'Student', get: (d) => d.label, fmt: (d) => d.label, cls: 'name' },
  { key: 'title', label: 'Document', get: (d) => d.title, fmt: (d) => d.title || '' , cls: 'name' },
  { key: 'words', label: 'Words', get: (d) => d.row && d.row.words, fmt: (d) => String(d.row.words) },
  { key: 'mix', label: 'How it was written', get: (d) => d.row && d.row.composed, fmt: (d) => mixBar(d.row.shares), title: 'Students’ text by category; sorts by the share written straight through' },
  { key: 'composed', label: 'Written straight through', get: (d) => d.row && d.row.composed, fmt: (d) => pct(d.row.composed) },
  { key: 'revised', label: 'Revised', get: (d) => d.row && d.row.revised, fmt: (d) => pct(d.row.revised) },
  { key: 'large', label: 'Added all at once', get: (d) => d.row && d.row.large, fmt: (d) => pct(d.row.large) },
  { key: 'typed', label: 'Typed (chars)', get: (d) => d.row && d.row.typed, fmt: (d) => d.row.typed.toLocaleString() },
  { key: 'chunked', label: 'Added all at once (chars)', get: (d) => d.row && d.row.chunked, fmt: (d) => `${d.row.chunked.toLocaleString()}${d.row.chunks ? ` (${d.row.chunks}×)` : ''}` },
  { key: 'copied', label: 'Copied within Doc (chars)', get: (d) => d.row && d.row.copied, fmt: (d) => (d.row.copied || 0).toLocaleString(), title: 'Text copied or moved from elsewhere in the same Doc, such as a draft pasted into the final section' },
  { key: 'retyped', label: 'Typed beside a deleted paste (words)', get: (d) => d.row && d.row.retyped, fmt: (d) => (d.row.retyped || 0).toLocaleString(), title: 'Words typed while a paste with many of the same words was in the Doc; that paste was later deleted' },
  { key: 'deleted', label: 'Deleted (chars)', get: (d) => d.row && d.row.deleted, fmt: (d) => d.row.deleted.toLocaleString() },
  { key: 'school', label: 'In school', get: (d) => d.row && d.row.school, fmt: (d) => pct(d.row.school) },
  { key: 'home', label: 'Outside school', get: (d) => d.row && d.row.home, fmt: (d) => pct(d.row.home) },
  { key: 'late', label: 'After due', get: (d) => d.row && d.row.late, fmt: (d) => (dash.dueAt ? pct(d.row.late) : '—') },
  { key: 'activeMs', label: 'Active', get: (d) => d.row && d.row.activeMs, fmt: (d) => duration(d.row.activeMs) },
  { key: 'sessions', label: 'Sessions', get: (d) => d.row && d.row.sessions, fmt: (d) => String(d.row.sessions) },
  { key: 'students', label: 'Student editors', get: (d) => d.row && d.row.students, fmt: (d) => String(d.row.students) },
  { key: 'lastT', label: 'Last edit', get: (d) => d.row && d.row.lastT, fmt: (d) => fmtTime(d.row.lastT) },
];

function mixBar(shares) {
  return h('div', { class: 'mini-bar', title: STUDENT_CATS.filter((k) => shares[k] > 0).map((k) => `${CATEGORY_TEXT.teacher[k].label} ${pct(shares[k])}`).join(' · ') },
    STUDENT_CATS.filter((k) => shares[k] > 0).map((k) => h('span', { style: `width:${(shares[k] * 100).toFixed(1)}%;background:rgb(var(${COLOR_VAR[k]}))` })));
}

function drawTable() {
  const t = clear($('dash-table'));
  t.appendChild(h('tr', {}, COLS.map((c) => h('th', {
    scope: 'col', title: c.title || null, 'aria-sort': sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : null,
    onclick: () => { sort = { key: c.key, dir: sort.key === c.key ? -sort.dir : 1 }; drawTable(); }, text: c.label,
  })), h('th', { text: 'Review' }), h('th', { text: '' })));
  const col = COLS.find((c) => c.key === sort.key) || COLS[0];
  const rows = [...docs].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) : x - y) * sort.dir;
  });
  for (const d of rows) {
    const cells = COLS.map((c) => {
      if (c.key === 'label' || c.key === 'title') return h('td', { class: c.cls }, c.fmt(d));
      if (!d.row) return h('td', { class: d.state === 'error' ? 'state-error' : 'hint', text: c.key === 'words' ? (d.state === 'error' ? d.error : d.state) : '' });
      return h('td', {}, c.fmt(d));
    });
    const review = h('select', { 'aria-label': `Review status for ${d.label}`, onchange: async (e) => { dash.review[d.docId] = Number(e.target.value); await saveDash(); } },
      REVIEW.map((r, k) => h('option', { value: String(k), selected: (dash.review[d.docId] || 0) === k, text: r })));
    t.appendChild(h('tr', {}, cells, h('td', {}, review),
      h('td', {}, h('button', { type: 'button', disabled: !d.result, onclick: () => openViewer(d), text: 'Open' }))));
  }
}

async function openViewer(d, extra = {}) {
  const key = crypto.randomUUID();
  await chrome.storage.session.set({ [`job:${key}`]: { docId: d.docId, u: d.u, title: d.label ? `${d.label}${d.title ? ` – ${d.title}` : ''}` : d.title, expires: Date.now() + 12 * 3600 * 1000, ...extra } });
  chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html#k=${key}`) });
}

function downloadCsv() {
  const head = ['Student', 'Document', ...COLS.slice(2).filter((c) => c.key !== 'mix').map((c) => c.label), 'Review'];
  const body = docs.map((d) => {
    const r = d.row;
    const vals = r ? [r.words, r.composed, r.revised, r.large, r.typed, r.chunked, r.copied || 0, r.retyped || 0, r.deleted, r.school, r.home, dash.dueAt ? r.late : '', Math.round(r.activeMs / 60000), r.sessions, r.students, r.lastT ? new Date(r.lastT).toISOString() : '']
      .map((v) => (typeof v === 'number' && v > 0 && v < 1 ? Math.round(v * 1000) / 10 : v)) : [d.state === 'error' ? d.error : d.state];
    return [d.label, d.title, ...vals, REVIEW[dash.review[d.docId] || 0]];
  });
  const csv = toCsv([head, ...body]);
  const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `${(dash.name || 'class').replace(/[^a-z0-9-]+/gi, '-')}-writing-heatmap.csv` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- the same section in every document ----------
function readyDocs() { return docs.filter((d) => d.result); }

// Sections most documents share; the rest sit behind a "show" link.
let showAllSections = false;
function classSections(ready, moreId) {
  const { shown, hidden, need } = majoritySections(ready.map((d) => ({ id: d.docId, result: d.result })), showAllSections);
  const more = $(moreId);
  more.hidden = !hidden && !showAllSections;
  more.textContent = showAllSections ? 'Show only sections most documents have'
    : `Show ${hidden} more found in fewer than ${need} of ${ready.length} documents`;
  return shown;
}

// The documents as they stood at a checkpoint (secView.asOf), or now.
function resultAt(d) {
  return secView.asOf == null ? d.result : cpCache.get(`${d.docId}@${secView.asOf}`) || null;
}

// One document as it stood at time t, worked out once: a second request
// for the same moment waits for the first instead of starting again.
let inflight = new Map();
let cpFailed = new Set();
function asOfFor(d, t) {
  const k = `${d.docId}@${t}`;
  if (cpCache.has(k)) return Promise.resolve(cpCache.get(k));
  if (!inflight.has(k)) {
    const cache = cpCache;
    inflight.set(k, (async () => {
      try {
        const r = await analyze({ ...(await inputFor(d)), asOf: t, deleteInclusive: d.result.diagnostics.deleteInclusive, headingMarks: d.result.headingMarks });
        cache.set(k, r);
        return r;
      } catch { cpFailed.add(k); return null; } finally { inflight.delete(k); }
    })());
  }
  return inflight.get(k);
}

let filling = false;
async function fillAsOf() {
  if (filling || secView.asOf == null) return;
  filling = true;
  try {
    // The moment asked for can change while this runs; each step reads it again.
    for (let next = nextMissing(); next; next = nextMissing()) {
      await asOfFor(next, secView.asOf);
      if (page === 'sections') drawSections();
    }
  } finally { filling = false; }
}
function nextMissing() {
  if (secView.asOf == null) return null;
  return readyDocs().find((d) => { const k = `${d.docId}@${secView.asOf}`; return !cpCache.has(k) && !cpFailed.has(k); }) || null;
}

// Quick check: each document's student words in the chosen sections, by
// how they were written. -> { found, total, words: { cat: n }, retyped, moved } | null
function sectionStats(r, keys) {
  if (!r) return null;
  const parts = keys[0] === WHOLE ? r.tabs
    : keys.map((key) => { const tab = r.tabs.find((t) => (t.sections || []).some((x) => x.key === key)); return tab && sliceSection(tab, key); }).filter(Boolean);
  const out = { found: parts.length, total: 0, words: {}, retyped: 0, moved: 0 };
  for (const p of parts) for (const sp of p.spans) {
    if (!sp.owner || !sp.owner.startsWith('student:') || !sp.words) continue;
    out.total += sp.words;
    out.words[sp.cat] = (out.words[sp.cat] || 0) + sp.words;
    if ((sp.badges || []).includes('retyped')) out.retyped += sp.words;
    if ((sp.badges || []).includes('moved')) out.moved += sp.words;
  }
  return out;
}

// A wide bar of the colors, each part sized by its words; hovering names them.
function quickBar(st) {
  const cats = STUDENT_CATS.filter((k) => st.words[k] > 0);
  const label = cats.map((k) => `${CATEGORY_TEXT.teacher[k].label}: ${st.words[k]} words`).join(' · ');
  return h('div', { class: 'quick-bar', title: label, role: 'img', 'aria-label': label || 'No student words' },
    cats.map((k) => h('span', { style: `flex:${st.words[k]};background:rgb(var(${COLOR_VAR[k]}))` })));
}

const QUICK_SORT = {
  list: () => 0,
  large: (a, b) => ((b.st && b.st.words.large) || 0) - ((a.st && a.st.words.large) || 0),
  revised: (a, b) => ((b.st && (b.st.words.light || 0) + (b.st.words.heavy || 0)) || 0) - ((a.st && (a.st.words.light || 0) + (a.st.words.heavy || 0)) || 0),
  words: (a, b) => ((a.st && a.st.total) ?? Infinity) - ((b.st && b.st.total) ?? Infinity),
};

function drawSections() {
  const ready = readyDocs();
  const secs = classSections(ready, 'sec-more');
  const chips = clear($('sec-chips'));
  if (!secs.length) {
    chips.appendChild(h('p', { class: 'hint', text: !ready.length ? 'Press “Analyze all” first.' : $('sec-more').hidden ? 'No sections found.' : 'No section is shared by most documents.' }));
    clear($('sec-list'));
    return;
  }
  secView.keys = secView.keys.filter((k) => k === WHOLE || secs.some((s) => s.key === k));
  // The first section is checked to start with; once the teacher has checked
  // or unchecked anything, an empty choice stays empty.
  if (!secView.keys.length && !secView.picked) secView.keys = [secs[0].key];
  const order = (k) => secs.findIndex((s) => s.key === k);
  // "Whole document" shows each copy in full; it and the sections exclude each other.
  const whole = h('input', { type: 'checkbox', checked: secView.keys.includes(WHOLE), onchange: (e) => {
    secView.keys = e.target.checked ? [WHOLE] : [];
    secView.picked = true;
    secView.current = 0;
    drawSections();
  } });
  chips.appendChild(h('label', { class: 'chip chip-whole' }, whole, ' Whole document '));
  for (const sec of secs) {
    const box = h('input', { type: 'checkbox', checked: secView.keys.includes(sec.key), onchange: (e) => {
      const keys = secView.keys.filter((k) => k !== WHOLE);
      secView.keys = e.target.checked ? [...keys, sec.key].sort((a, b) => order(a) - order(b)) : keys.filter((k) => k !== sec.key);
      secView.picked = true;
      secView.current = 0;
      drawSections();
    } });
    chips.appendChild(h('label', { class: 'chip' }, box, ` ${sec.label} `, h('span', { class: 'hint', text: `${sec.count}/${ready.length}` })));
  }
  for (const [id, c] of [['sec-by-process', 'process'], ['sec-by-writer', 'writer'], ['sec-by-when', 'when']]) $(id).setAttribute('aria-pressed', String(secView.colorBy === c));
  $('sec-mode-quick').setAttribute('aria-pressed', String(secView.quick));
  $('sec-mode-full').setAttribute('aria-pressed', String(!secView.quick));
  $('quick-tools').hidden = !secView.quick;
  $('quick-sort').value = secView.sort;
  if (ready.length) renderLegend($('sec-legend'), ready[0].result, 'teacher', secView);
  $('sec-legend').hidden = secView.colorBy === 'writer';

  const asof = clear($('sec-asof'));
  asof.hidden = secView.asOf == null;
  if (secView.asOf != null) {
    asof.append(`As each document stood at ${secView.asOfLabel ? `${secView.asOfLabel}, ` : ''}${fmtTime(secView.asOf)}. `,
      h('button', { type: 'button', class: 'link', onclick: () => { secView.asOf = null; secView.asOfLabel = ''; drawSections(); }, text: 'Back to now' }));
  }

  const many = secView.keys.length > 1;
  const isWhole = secView.keys[0] === WHOLE;
  const list = clear($('sec-list'));
  if (!secView.keys.length) { list.appendChild(h('p', { class: 'hint', text: 'Check “Whole document” or one or more sections above to show them from every document.' })); return; }
  // Working out how each document stood at a checkpoint takes a while on a
  // full class: say so plainly at the top, with how far along it is.
  if (secView.asOf != null) {
    const have = ready.filter((d) => resultAt(d) || cpFailed.has(`${d.docId}@${secView.asOf}`)).length;
    if (have < ready.length) {
      list.appendChild(h('div', { class: 'sec-loading', role: 'status' },
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        h('div', { class: 'grow' },
          h('strong', { text: `Going back to ${secView.asOfLabel || fmtTime(secView.asOf)}…` }),
          h('div', { class: 'hint', text: `Working out how each document stood then: ${have} of ${ready.length} ready. Each one appears below as soon as it is done.` }),
          h('div', { class: 'load-track' }, h('span', { style: `width:${((have / ready.length) * 100).toFixed(1)}%` })))));
    }
  }
  let waiting = false;
  const where = isWhole ? 'the document' : many ? 'these sections' : 'this section';
  const rows = ready.map((d, n) => ({ d, n, r: resultAt(d) })).map((x) => ({ ...x, st: sectionStats(x.r, secView.keys) }));
  if (secView.quick) rows.sort((x, y) => QUICK_SORT[secView.sort](x, y) || x.n - y.n);
  rows.forEach(({ d, r, st }, k) => {
    const failed = !r && secView.asOf != null && cpFailed.has(`${d.docId}@${secView.asOf}`);
    if (!r && !failed) waiting = true;
    const open = !secView.quick || secView.open.has(d.docId);
    const body = h('article', { class: 'doc' });
    if (open) {
      if (failed) body.appendChild(h('p', { class: 'hint', text: 'Could not work out how this document stood then.' }));
      else if (!r) body.appendChild(h('div', { class: 'sec-pending' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Working out how this document stood then…'));
      else if (isWhole) {
        for (const tab of r.tabs) {
          if (!tab.spans.length) continue;
          const part = h('div', {});
          renderDoc(part, tab, r, 'teacher', secView, () => openViewer(d, { asOf: secView.asOf ?? undefined }));
          body.appendChild(part);
        }
      } else {
        for (const key of secView.keys) {
          const tab = r.tabs.find((t) => (t.sections || []).some((s) => s.key === key));
          const slice = tab && sliceSection(tab, key);
          if (many) body.appendChild(h('h4', { class: 'sec-part', text: (secs.find((s) => s.key === key) || {}).label || key }));
          if (!slice) { body.appendChild(h('p', { class: 'hint', text: 'This document has no such section.' })); continue; }
          const part = h('div', {});
          renderDoc(part, slice, r, 'teacher', secView, () => openViewer(d, { section: key, asOf: secView.asOf ?? undefined }));
          body.appendChild(part);
        }
      }
    }
    const openFull = h('button', { type: 'button', class: 'link', onclick: (e) => { e.stopPropagation(); openViewer(d, { section: isWhole ? undefined : secView.keys[0], asOf: secView.asOf ?? undefined }); }, text: 'Open full document' });
    const nk = `${d.docId}|${secView.keys.join(',')}`;
    const note = notes.get(nk);
    // Words selected in this student's text are kept as what the comment is on.
    let picked = '';
    const comment = h('button', { type: 'button', class: 'link',
      onmousedown: (e) => { const sel = getSelection(); const card = e.target.closest('.sec-card'); picked = sel && !sel.isCollapsed && card && card.contains(sel.anchorNode) ? sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300) : ''; },
      onclick: (e) => {
        e.stopPropagation();
        const cur = notes.get(nk);
        notes.set(nk, { text: cur ? cur.text : '', quote: picked || (cur ? cur.quote : ''), open: true, copied: false, sent: cur ? cur.sent : 0 });
        if (secView.quick) secView.open.add(d.docId);
        secView.current = k;
        focusNote = nk;
        drawSections();
      },
      text: note && note.sent ? `Comment (${note.sent} copied)` : 'Comment' });
    let head;
    if (secView.quick) {
      const toggle = () => { if (secView.open.has(d.docId)) secView.open.delete(d.docId); else secView.open.add(d.docId); secView.current = k; drawSections(); };
      const review = h('select', { class: 'quick-review', 'aria-label': `Review status for ${d.label}`, onclick: (e) => e.stopPropagation(),
        onchange: async (e) => { dash.review[d.docId] = Number(e.target.value); await saveDash(); } },
      REVIEW.map((t, v) => h('option', { value: String(v), selected: (dash.review[d.docId] || 0) === v, text: t })));
      const facts = !st ? (failed ? 'could not be worked out' : 'working this out…')
        : !st.found ? `no such ${isWhole ? 'document' : 'section'}`
          : [`${st.total} words`, st.words.large ? `${st.words.large} added all at once` : '', st.retyped ? `${st.retyped} typed beside a deleted paste` : '', st.moved ? `${st.moved} copied within the Doc` : ''].filter(Boolean).join(' · ');
      head = h('div', { class: 'sec-head quick-head', role: 'button', tabindex: '0', 'aria-expanded': String(open), onclick: toggle,
        onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } } },
      h('span', { class: 'caret', 'aria-hidden': 'true', text: open ? '▾' : '▸' }),
      h('strong', { class: 'quick-name', text: d.label }),
      st && st.found ? quickBar(st) : h('span', { class: 'quick-bar empty' }),
      h('span', { class: `hint quick-facts${st && st.words.large ? ' has-large' : ''}`, text: facts }),
      review, comment, openFull);
    } else {
      head = h('div', { class: 'sec-head' },
        h('strong', { text: d.label }), h('span', { class: 'hint', text: d.title }),
        st && st.found ? h('span', { class: 'hint', text: `${st.total} student words in ${where}` }) : null,
        h('span', { class: 'grow' }), comment, openFull);
    }
    list.appendChild(h('section', { class: `sec-card${k === secView.current ? ' current' : ''}${secView.quick ? ' quick' : ''}${open ? ' open' : ''}`, id: `sec-${k}`, dataset: { doc: d.docId } },
      head, open && note && note.open ? commentBox(d, r, nk) : null, open ? body : null));
  });
  if (focusNote) {
    const box = [...document.querySelectorAll('.cmt-box')].find((b) => b.dataset.note === focusNote);
    if (box) box.querySelector('textarea').focus();
    focusNote = null;
  }
  if (waiting) fillAsOf();
}

// Where a comment is meant to go: the first checked section's heading, so the
// Doc opens there, or the top of the Doc when the heading's id is unknown.
function noteTarget(r) {
  const key = secView.keys[0];
  if (!r || key === WHOLE) return {};
  for (const t of r.tabs) {
    const sec = (t.sections || []).find((x) => x.key === key);
    if (sec) return { tabId: t.id || '', hid: sec.hid || null };
  }
  return {};
}

// Write a comment here, then copy it and open the student's Doc to paste it
// on the words it is about. Nothing is posted for the teacher.
function commentBox(d, r, nk) {
  const n = notes.get(nk);
  const target = noteTarget(r);
  const ta = h('textarea', { class: 'cmt-text', rows: '3', 'aria-label': `Comment for ${d.label}`, placeholder: `Comment for ${d.label}`,
    oninput: (e) => { n.text = e.target.value; } });
  ta.value = n.text;
  const status = h('p', { class: 'hint cmt-status', role: 'status' });
  const short = n.quote.length > 60 ? `${n.quote.slice(0, 60)}…` : n.quote;
  const steps = () => `Copied. In the Doc${target.hid ? '' : ', find this section'}: select the words${short ? ` (${MAC ? '⌘+F' : 'Ctrl+F'} finds “${short}”)` : ''}, press ${MAC ? '⌘+Option+M' : 'Ctrl+Alt+M'}, then paste.`;
  if (n.copied) status.textContent = steps();
  const go = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    try { await navigator.clipboard.writeText(text); } catch { status.textContent = 'Could not copy. Select the comment, press Ctrl+C, then open the Doc.'; return; }
    if (!n.copied) n.sent++;
    n.copied = true;
    status.textContent = steps();
    goBtn.textContent = 'Copy and open again';
    doneBtn.textContent = 'Done';
    chrome.tabs.create({ url: docLink(d, target) });
  };
  const goBtn = h('button', { type: 'button', class: 'primary', onclick: go, text: n.copied ? 'Copy and open again' : 'Copy and open Doc' });
  const done = () => { notes.set(nk, { text: '', quote: '', open: false, copied: false, sent: n.sent }); drawSections(); };
  const doneBtn = h('button', { type: 'button', onclick: done, text: n.copied ? 'Done' : 'Cancel' });
  return h('div', { class: 'cmt-box', dataset: { note: nk } },
    n.quote ? h('p', { class: 'cmt-quote' }, 'On: ', h('q', { text: short })) : null,
    ta,
    h('div', { class: 'cmt-actions' }, goBtn, doneBtn),
    status);
}

function stepSection(dir) {
  const n = readyDocs().length;
  if (!n) return;
  secView.current = (secView.current + dir + n) % n;
  if (secView.quick) {
    const card = $(`sec-${secView.current}`);
    secView.open = new Set(card ? [card.dataset.doc] : []);
    drawSections();
  }
  for (const el of document.querySelectorAll('.sec-card')) el.classList.toggle('current', el.id === `sec-${secView.current}`);
  const el = $(`sec-${secView.current}`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------- checkpoints ----------
async function drawCheckpoints(fill = true) {
  const cps = [...(dash.checkpoints || [])].sort((a, b) => a.t - b.t);
  const ready = readyDocs();
  const secs = classSections(ready, 'dcp-more');
  const sel = clear($('dcp-section'));
  sel.appendChild(h('option', { value: '', text: 'Whole document' }));
  if (!ready.length) sel.appendChild(h('option', { value: '', disabled: true, text: 'Press “Analyze all” to list sections' }));
  for (const s of secs) sel.appendChild(h('option', { value: s.key, selected: s.key === drawCheckpoints.section, text: s.label }));
  const key = drawCheckpoints.section || '';
  const words = (r) => {
    if (!r) return null;
    if (!key) return r.summary.studentWords;
    let n = 0;
    for (const t of r.tabs) for (const sec of t.sections || []) if (sec.key === key) for (const [o, w] of Object.entries(sec.words)) if (o.startsWith('student:')) n += w;
    return n;
  };
  const table = clear($('dcp-table'));
  // Every number opens that student's document there, as it stood then;
  // "See in every document" shows the section from every copy at once.
  const seeAll = (t, label) => {
    page = 'sections';
    secView.asOf = t;
    secView.asOfLabel = label || '';
    // The section chosen under "Count words in", or the whole document.
    secView.keys = [key || WHOLE];
    secView.picked = true;
    secView.current = 0;
    drawAll();
    document.querySelector('.page-tabs').scrollIntoView({ block: 'start' });
  };
  const open = (d, t) => openViewer(d, { section: key || undefined, asOf: t ?? undefined });
  const num = (d, r, t) => h('td', {}, r
    ? h('button', { type: 'button', class: 'link', title: `Open ${d.label || 'this document'}${key ? ' at this section' : ''}${t == null ? '' : ', as it stood then'}`, onclick: () => open(d, t), text: String(words(r)) })
    : '…');
  table.appendChild(h('tr', {}, h('th', { text: 'Student' }), cps.map((c, k) => h('th', {},
    h('div', { text: c.label || `Checkpoint ${k + 1}` }), h('div', { class: 'hint', text: fmtTime(c.t) }),
    h('div', { class: 'cp-actions' },
      h('button', { type: 'button', class: 'link', onclick: () => seeAll(c.t, c.label || `Checkpoint ${k + 1}`), text: 'See in every document' }),
      h('button', { type: 'button', class: 'link', onclick: async () => { dash.checkpoints = cps.filter((_, j) => j !== k); await saveDash(); drawCheckpoints(); }, text: 'Remove' })))),
  h('th', {}, h('div', { text: 'Now' }), h('div', { class: 'cp-actions' }, h('button', { type: 'button', class: 'link', onclick: () => seeAll(null, ''), text: 'See in every document' })))));
  const rows = ready.map((d) => {
    const cells = cps.map((c) => (cpFailed.has(`${d.docId}@${c.t}`) ? h('td', { class: 'hint', title: 'Could not work out how this document stood then', text: '—' }) : num(d, cpCache.get(`${d.docId}@${c.t}`), c.t)));
    return h('tr', {}, h('th', { scope: 'row', text: d.label }), cells, num(d, d.result, null));
  });
  for (const r of rows) table.appendChild(r);
  if (fill) fillCheckpoints();
}

// Fill in what is missing, one analysis at a time, only while the
// Checkpoints tab is showing: on another tab the work it asks for comes first.
let fillingTable = false;
async function fillCheckpoints() {
  if (fillingTable) return;
  fillingTable = true;
  try {
    for (;;) {
      if (page !== 'checkpoints') return;
      const cps = dash.checkpoints || [];
      let next = null;
      for (const c of [...cps].sort((x, y) => x.t - y.t)) {
        const d = readyDocs().find((x) => { const k = `${x.docId}@${c.t}`; return !cpCache.has(k) && !cpFailed.has(k); });
        if (d) { next = [d, c.t]; break; }
      }
      if (!next) return;
      await asOfFor(...next);
      if (page === 'checkpoints') drawCheckpoints(false);
    }
  } finally { fillingTable = false; }
}

// ---------- page ----------
function drawAll() {
  for (const [id, p] of [['tab-table', 'table'], ['tab-sections', 'sections'], ['tab-checkpoints', 'checkpoints']]) $(id).setAttribute('aria-selected', String(page === p));
  $('view-table').hidden = page !== 'table';
  $('view-sections').hidden = page !== 'sections';
  $('view-checkpoints').hidden = page !== 'checkpoints';
  if (page === 'table') drawTable();
  if (page === 'sections') drawSections();
  if (page === 'checkpoints') drawCheckpoints();
}

async function refreshPicker() {
  const all = await listDashes();
  const pick = clear($('dash-pick'));
  for (const d of all) pick.appendChild(h('option', { value: d.id, selected: d.id === dash.id, text: d.name || 'Untitled dashboard' }));
  if (!all.some((d) => d.id === dash.id)) pick.appendChild(h('option', { value: dash.id, selected: true, text: dash.name || 'New dashboard' }));
}

function showDash(d) {
  dash = d;
  docs = [];
  cpCache = new Map();
  inflight = new Map();
  cpFailed = new Set();
  $('dash-name').value = dash.name || '';
  $('dash-links').value = dash.links || '';
  $('dash-due').value = toLocalInput(dash.dueAt);
  status('');
  drawAll();
}

for (const [id, p] of [['tab-table', 'table'], ['tab-sections', 'sections'], ['tab-checkpoints', 'checkpoints']]) $(id).addEventListener('click', () => { page = p; drawAll(); });
for (const [id, c] of [['sec-by-process', 'process'], ['sec-by-writer', 'writer'], ['sec-by-when', 'when']]) $(id).addEventListener('click', () => { secView.colorBy = c; drawSections(); });
for (const id of ['sec-more', 'dcp-more']) $(id).addEventListener('click', () => { showAllSections = !showAllSections; drawSections(); drawCheckpoints(); });
$('sec-next').addEventListener('click', () => stepSection(1));
$('sec-mode-quick').addEventListener('click', () => { secView.quick = true; drawSections(); });
$('sec-mode-full').addEventListener('click', () => { secView.quick = false; drawSections(); });
$('quick-sort').addEventListener('change', (e) => { secView.sort = e.target.value; secView.current = 0; drawSections(); });
$('quick-open-all').addEventListener('click', () => { secView.open = new Set(readyDocs().map((d) => d.docId)); drawSections(); });
$('quick-close-all').addEventListener('click', () => { secView.open = new Set(); drawSections(); });
$('sec-prev').addEventListener('click', () => stepSection(-1));
$('dash-run').addEventListener('click', runAll);
// The name and links save as they are typed, so renaming a dashboard or
// pasting links sticks without pressing "Analyze all".
let typingTimer = 0;
for (const id of ['dash-name', 'dash-links']) $(id).addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(async () => {
    dash.name = $('dash-name').value.trim();
    dash.links = $('dash-links').value;
    await saveDash();
    await refreshPicker();
  }, 400);
});
$('dash-stop').addEventListener('click', () => { stopped = true; });
$('dash-csv').addEventListener('click', downloadCsv);
$('dash-due').addEventListener('change', async (e) => {
  dash.dueAt = e.target.value ? new Date(e.target.value).getTime() : null;
  await saveDash();
  status(docs.length ? 'Due date saved. Press “Analyze all” to apply it.' : 'Due date saved.');
});
$('dash-due-clear').addEventListener('click', async () => { $('dash-due').value = ''; dash.dueAt = null; await saveDash(); });
$('dcp-add').addEventListener('click', async () => {
  const v = $('dcp-date').value;
  if (!v) return;
  dash.checkpoints = [...(dash.checkpoints || []), { t: new Date(v).getTime(), label: $('dcp-name').value.trim() }];
  await saveDash();
  drawCheckpoints();
});
$('dcp-add-due').addEventListener('click', async () => {
  if (!dash.dueAt || (dash.checkpoints || []).some((c) => c.t === dash.dueAt)) return;
  dash.checkpoints = [...(dash.checkpoints || []), { t: dash.dueAt, label: 'Due' }];
  await saveDash();
  drawCheckpoints();
});
$('dcp-section').addEventListener('change', (e) => { drawCheckpoints.section = e.target.value; drawCheckpoints(); });
$('dash-pick').addEventListener('change', async (e) => {
  const all = await listDashes();
  const d = all.find((x) => x.id === e.target.value);
  if (d) showDash(d);
});
$('dash-new').addEventListener('click', async () => { showDash(newDash()); await refreshPicker(); });
$('dash-delete').addEventListener('click', async () => {
  if (!confirm('Delete this dashboard (its name, links, due date, checkpoints and review marks)?')) return;
  await chrome.storage.local.remove(`dash:${dash.id}`);
  const all = await listDashes();
  showDash(all[0] || newDash());
  await refreshPicker();
});
// ---------- class packs ----------
const DOC_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const PACK_ERRORS = {
  TOO_BIG: 'That file is too large to be a class pack.',
  NOT_A_PACK: 'That file is not a Writing Heatmap class pack.',
  EMPTY_PACK: 'That class pack has no dashboards in it.',
};
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function localState() {
  const all = await chrome.storage.local.get(null);
  const docsPrefs = {};
  for (const [k, v] of Object.entries(all)) if (k.startsWith('doc:') && v && v.expires > Date.now()) docsPrefs[k.slice(4)] = v;
  return { dashboards: await listDashes(), docs: docsPrefs, settings };
}

$('pack-share').addEventListener('click', async () => {
  if (dash.name || dash.links) await saveDash();
  const all = await listDashes();
  const box = clear($('pack-dashes'));
  for (const d of all) box.appendChild(h('label', { class: 'row' }, h('input', { type: 'checkbox', value: d.id, checked: true }), ` ${d.name || 'Untitled dashboard'} `, h('span', { class: 'hint', text: `${(d.links || '').split('\n').filter((l) => l.trim()).length} links` })));
  $('pack-share-dlg').showModal();
});
$('pack-share-cancel').addEventListener('click', () => $('pack-share-dlg').close());
$('pack-share-save').addEventListener('click', async () => {
  const ids = [...$('pack-dashes').querySelectorAll('input:checked')].map((b) => b.value);
  if (!ids.length) return;
  await loadSettings();
  const pack = buildPack(await localState(), { ids, roles: $('pack-roles').checked, school: $('pack-school').checked });
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(pack, null, 1)], { type: 'application/json' })), download: `writing-heatmap-class-pack-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  $('pack-share-dlg').close();
  status(`Saved a class pack with ${ids.length} dashboard${ids.length === 1 ? '' : 's'}. Send the file to your co-teacher.`);
});

let pendingPack = null;
$('pack-import').addEventListener('click', () => { $('pack-file').value = ''; $('pack-file').click(); });
$('pack-file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const got = readPack(await file.text());
  if (!got.ok) { status(PACK_ERRORS[got.error] || PACK_ERRORS.NOT_A_PACK); return; }
  pendingPack = got.pack;
  const mine = new Set((await listDashes()).map((d) => d.id));
  const prev = clear($('pack-preview'));
  prev.appendChild(h('p', { text: `Made ${got.pack.made ? new Date(got.pack.made).toLocaleString() : 'at an unknown time'}.` }));
  prev.appendChild(h('ul', {}, got.pack.dashboards.map((d) => h('li', {}, `${d.name || 'Untitled dashboard'} `,
    h('span', { class: 'hint', text: `${d.links.split('\n').length} links · ${mine.has(d.id) ? 'updates yours' : 'new'}` })))));
  const nRoles = Object.keys(got.pack.roles).length;
  if (nRoles) prev.appendChild(h('p', { class: 'hint', text: `Editor roles for ${nRoles} ${nRoles === 1 ? 'person' : 'people'} (yours are kept where you already set one).` }));
  const sch = got.pack.school;
  $('pack-school-row').hidden = !sch;
  if (sch) $('pack-school-text').textContent = sch.on ? `Use the pack’s school hours: ${sch.schedule.days.map((d) => DAY[d]).join(', ')}, ${sch.schedule.start}–${sch.schedule.end}` : 'Use the pack’s setting: school hours off';
  $('pack-import-dlg').showModal();
});
$('pack-import-cancel').addEventListener('click', () => { pendingPack = null; $('pack-import-dlg').close(); });
$('pack-import-go').addEventListener('click', async () => {
  if (!pendingPack) return;
  await loadSettings();
  const merged = mergePack(await localState(), pendingPack, { school: !$('pack-school-row').hidden && $('pack-use-school').checked });
  const now = Date.now();
  const writes = {};
  for (const d of merged.dashboards) writes[`dash:${d.id}`] = { ...d, updated: now, expires: now + DASH_TTL_MS };
  for (const [id, p] of Object.entries(merged.docs)) writes[`doc:${id}`] = { ...p, expires: now + DOC_TTL_MS };
  const { settings: cur } = await chrome.storage.local.get('settings');
  const next = { ...(cur || {}), roles: merged.roles };
  if (merged.school) { next.schoolOn = merged.school.on; next.schedule = merged.school.schedule; }
  writes.settings = next;
  await chrome.storage.local.set(writes);
  await loadSettings();
  pendingPack = null;
  $('pack-import-dlg').close();
  const first = merged.dashboards[0];
  showDash(writes[`dash:${first.id}`]);
  await refreshPicker();
  const { added, updated } = merged.summary;
  status(`Imported: ${added} new dashboard${added === 1 ? '' : 's'}, ${updated} updated. Press “Analyze all” to read the documents.`);
});

new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${document.querySelector('.top').offsetHeight}px`)).observe(document.querySelector('.top'));
// The section view's toolbar sticks under the top bar; each student's name
// bar sticks under the toolbar, so it needs the toolbar's height.
const secTools = document.querySelector('#view-sections .doc-tools');
new ResizeObserver(() => document.documentElement.style.setProperty('--tools-h', `${secTools.offsetHeight}px`)).observe(secTools);

(async () => {
  await loadSettings();
  const all = await listDashes();
  showDash(all[0] || newDash());
  await refreshPicker();
})();

