// The class dashboard: many documents at once, from pasted links. Each
// history is read with the teacher's own sign-in (directly, or through a
// background tab that closes again), analysed here, and kept in memory only.
// Saved in this browser: the dashboard's name, links, due date, checkpoints
// and review marks. Never saved: any document text or analysis.

import { h, clear, fmtTime } from './dom.js';
import { DocFetcher, loadHistory } from './fetcher.js';
import { directGet, directContext, withBackgroundTab } from './net.js';
import { parseLinks, rowMetrics, majoritySections, sliceSection, toCsv } from '../lib/classroom.js';
import { renderDoc, renderLegend } from './render.js';
import { pct, duration } from '../lib/report.js';
import { CATEGORY_TEXT } from '../lib/wording.js';
import { STUDENT_CATS } from '../lib/classify.js';
import { expiresAt } from '../lib/ttl.js';
import { DEFAULT_SETTINGS, getDocPrefs, scheduleOf, toLocalInput } from './prefs.js';

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
const secView = { colorBy: 'process', focus: '', key: '', current: 0 };
let cpCache = new Map(); // `${docId}@${t}` -> result

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
const analyse = (input) => new Promise((resolve, reject) => {
  const id = nextId++;
  waiting.set(id, { resolve, reject });
  worker.postMessage({ id, type: 'analyze', input, light: true, slim: true });
});

// ---------- storage ----------
async function loadSettings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  settings = { ...structuredClone(DEFAULT_SETTINGS), ...(s || {}) };
}
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
    pages: doc.raw.pages, exportText: doc.raw.exportText, snapshotBody: doc.raw.snapshotBody, tilesBody: doc.raw.tilesBody,
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
    doc.state = 'Analysing…';
    drawTable();
    doc.result = await analyse(await inputFor(doc));
    doc.row = rowMetrics(doc.result);
    doc.state = 'done';
  } catch (err) {
    doc.state = 'error';
    doc.error = err.code === 'NO_ACCESS' ? 'No edit access' : 'Could not load';
  }
  drawTable();
}

async function runAll() {
  await loadSettings(); // a change made in the viewer's Settings applies from the next run
  dash.links = $('dash-links').value;
  dash.name = $('dash-name').value.trim();
  await saveDash();
  await refreshPicker();
  const items = parseLinks(dash.links);
  if (!items.length) { status('Paste at least one Google Doc link.'); return; }
  docs = items.map((it, k) => ({ ...it, label: it.label || `Student ${k + 1}`, title: '', state: 'Waiting', raw: null, result: null, row: null }));
  cpCache = new Map();
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
  { key: 'mix', label: 'How it was written', get: (d) => d.row && d.row.composed, fmt: (d) => mixBar(d.row.shares), title: 'Students’ text by category; sorts by the share composed in place' },
  { key: 'composed', label: 'Composed in place', get: (d) => d.row && d.row.composed, fmt: (d) => pct(d.row.composed) },
  { key: 'revised', label: 'Revised', get: (d) => d.row && d.row.revised, fmt: (d) => pct(d.row.revised) },
  { key: 'large', label: 'Large chunks', get: (d) => d.row && d.row.large, fmt: (d) => pct(d.row.large) },
  { key: 'typed', label: 'Typed (chars)', get: (d) => d.row && d.row.typed, fmt: (d) => d.row.typed.toLocaleString() },
  { key: 'chunked', label: 'Added at once (chars)', get: (d) => d.row && d.row.chunked, fmt: (d) => `${d.row.chunked.toLocaleString()}${d.row.chunks ? ` (${d.row.chunks}×)` : ''}` },
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
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
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
    const vals = r ? [r.words, r.composed, r.revised, r.large, r.typed, r.chunked, r.deleted, r.school, r.home, dash.dueAt ? r.late : '', Math.round(r.activeMs / 60000), r.sessions, r.students, r.lastT ? new Date(r.lastT).toISOString() : '']
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

function drawSections() {
  const ready = readyDocs();
  const secs = classSections(ready, 'sec-more');
  const pick = clear($('sec-pick'));
  if (!secs.length) {
    pick.appendChild(h('option', { value: '', text: !ready.length ? 'Analyse the documents first' : $('sec-more').hidden ? 'No sections found' : 'No section is shared by most documents' }));
    clear($('sec-list'));
    return;
  }
  if (!secs.some((s) => s.key === secView.key)) secView.key = secs[0].key;
  for (const s of secs) pick.appendChild(h('option', { value: s.key, selected: s.key === secView.key, text: `${s.label} (in ${s.count} of ${ready.length})` }));
  for (const [id, c] of [['sec-by-process', 'process'], ['sec-by-writer', 'writer'], ['sec-by-when', 'when']]) $(id).setAttribute('aria-pressed', String(secView.colorBy === c));
  if (ready.length) renderLegend($('sec-legend'), ready[0].result, 'teacher', secView);
  $('sec-legend').hidden = secView.colorBy === 'writer';

  const list = clear($('sec-list'));
  ready.forEach((d, k) => {
    const tab = d.result.tabs.find((t) => (t.sections || []).some((s) => s.key === secView.key));
    const slice = tab && sliceSection(tab, secView.key);
    const body = h('article', { class: 'doc' });
    if (slice) renderDoc(body, slice, d.result, 'teacher', secView, () => openViewer(d, { section: secView.key }));
    else body.appendChild(h('p', { class: 'hint', text: 'This document has no such section.' }));
    list.appendChild(h('section', { class: `sec-card${k === secView.current ? ' current' : ''}`, id: `sec-${k}` },
      h('div', { class: 'sec-head' },
        h('strong', { text: d.label }), h('span', { class: 'hint', text: d.title }),
        slice ? h('span', { class: 'hint', text: `${slice.studentWords} student words in this section` }) : null,
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'link', onclick: () => openViewer(d, { section: secView.key }), text: 'Open full document' })),
      body));
  });
}

function stepSection(dir) {
  const n = readyDocs().length;
  if (!n) return;
  secView.current = (secView.current + dir + n) % n;
  for (const el of document.querySelectorAll('.sec-card')) el.classList.toggle('current', el.id === `sec-${secView.current}`);
  const el = $(`sec-${secView.current}`);
  if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ---------- checkpoints ----------
async function drawCheckpoints() {
  const cps = [...(dash.checkpoints || [])].sort((a, b) => a.t - b.t);
  const ready = readyDocs();
  const secs = classSections(ready, 'dcp-more');
  const sel = clear($('dcp-section'));
  sel.appendChild(h('option', { value: '', text: 'Whole document' }));
  if (!ready.length) sel.appendChild(h('option', { value: '', disabled: true, text: 'Press “Analyse all” to list sections' }));
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
  table.appendChild(h('tr', {}, h('th', { text: 'Student' }), cps.map((c, k) => h('th', {},
    h('div', { text: c.label || `Checkpoint ${k + 1}` }), h('div', { class: 'hint', text: fmtTime(c.t) }),
    h('button', { type: 'button', class: 'link', onclick: async () => { dash.checkpoints = cps.filter((_, j) => j !== k); await saveDash(); drawCheckpoints(); }, text: 'Remove' }))),
  h('th', { text: 'Now' })));
  const rows = ready.map((d) => {
    const cells = cps.map((c) => h('td', { text: cpCache.has(`${d.docId}@${c.t}`) ? `${words(cpCache.get(`${d.docId}@${c.t}`))}` : '…' }));
    return h('tr', {}, h('th', { scope: 'row', text: d.label }), cells, h('td', { text: String(words(d.result)) }));
  });
  for (const r of rows) table.appendChild(r);
  // Fill in what is missing, one analysis at a time.
  for (const c of cps) {
    for (const d of ready) {
      const k = `${d.docId}@${c.t}`;
      if (cpCache.has(k)) continue;
      const input = { ...(await inputFor(d)), asOf: c.t, deleteInclusive: d.result.diagnostics.deleteInclusive };
      cpCache.set(k, await analyse(input));
      if (page === 'checkpoints') return drawCheckpoints();
    }
  }
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
  $('dash-name').value = dash.name || '';
  $('dash-links').value = dash.links || '';
  $('dash-due').value = toLocalInput(dash.dueAt);
  status('');
  drawAll();
}

for (const [id, p] of [['tab-table', 'table'], ['tab-sections', 'sections'], ['tab-checkpoints', 'checkpoints']]) $(id).addEventListener('click', () => { page = p; drawAll(); });
for (const [id, c] of [['sec-by-process', 'process'], ['sec-by-writer', 'writer'], ['sec-by-when', 'when']]) $(id).addEventListener('click', () => { secView.colorBy = c; drawSections(); });
for (const id of ['sec-more', 'dcp-more']) $(id).addEventListener('click', () => { showAllSections = !showAllSections; drawSections(); drawCheckpoints(); });
$('sec-pick').addEventListener('change', (e) => { secView.key = e.target.value; secView.current = 0; drawSections(); });
$('sec-next').addEventListener('click', () => stepSection(1));
$('sec-prev').addEventListener('click', () => stepSection(-1));
$('dash-run').addEventListener('click', runAll);
// The name and links save as they are typed, so renaming a dashboard or
// pasting links sticks without pressing "Analyse all".
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
  status(docs.length ? 'Due date saved. Press “Analyse all” to apply it.' : 'Due date saved.');
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
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${document.querySelector('.top').offsetHeight}px`)).observe(document.querySelector('.top'));

(async () => {
  await loadSettings();
  const all = await listDashes();
  showDash(all[0] || newDash());
  await refreshPicker();
})();

