// The side panel beside a Google Doc: for each student, a short summary of
// how their text went in (added in large chunks, written straight through,
// retyped, revised). It follows whichever tab is active, reads the history
// the same way the viewer does, and reuses the viewer's session cache.

import { h, s as svg, clear, fmtTime } from './dom.js';
import { timelineModel } from '../lib/timeline.js';
import { ask, DocFetcher, loadHistory } from './fetcher.js';
import { DEFAULT_SETTINGS, getDocPrefs, scheduleOf, applyPalette } from './prefs.js';
import { writerLabel } from './render.js';
import { ERRORS } from '../lib/wording.js';
import { expiresAt, isExpired } from '../lib/ttl.js';
import { parseFileUrl, KIND } from '../lib/gdocs/endpoints.js';
import { pct, duration } from '../lib/report.js';

const $ = (id) => document.getElementById(id);
const CACHE_MAX_CHARS = 8_000_000;
const JOB_TTL_MS = 12 * 60 * 60 * 1000;

// How each student's final text went in, in the heatmap's colours.
const GROUPS = [
  { cats: ['large', 'pasted'], color: '--c-large', label: 'Added in large chunks (copy/paste)' },
  { cats: ['linear'], color: '--c-linear', label: 'Written straight through' },
  { cats: ['light'], color: '--c-light', label: 'Some retyping' },
  { cats: ['heavy'], color: '--c-heavy', label: 'Major revisions' },
  { cats: ['mixed', 'unclear'], color: '--c-unclear', label: 'Mixed or unclear' },
];

let settings = structuredClone(DEFAULT_SETTINGS);
let shown = { docId: null, tabId: null, result: null, ctx: null, raw: null, dueAt: null, checkpoints: [], cp: new Map() };
let seq = 0;

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
  try {
    const { settings: s } = await chrome.storage.local.get('settings');
    settings = { ...structuredClone(DEFAULT_SETTINGS), ...(s || {}) };
  } catch { /* defaults */ }
  applyPalette(settings);
}
async function readCache(docId) {
  const key = `cache:${docId}`;
  const got = (await chrome.storage.session.get(key))[key];
  return got && !isExpired(got, Date.now()) ? got : null;
}
async function writeCache(docId, lastRev, raw) {
  const entry = { expires: expiresAt(Date.now(), settings.ttlMin), lastRev, raw };
  if (JSON.stringify(entry).length > CACHE_MAX_CHARS) return;
  try { await chrome.storage.session.set({ [`cache:${docId}`]: entry }); } catch { /* over quota */ }
}

// The due date and checkpoints for this Doc: its own (set in the full view)
// and those of any class dashboard that lists it.
async function datesFor(docId, prefs) {
  const all = await chrome.storage.local.get(null);
  let dueAt = prefs.dueAt || null;
  const cps = new Map((prefs.checkpoints || []).map((c) => [c.t, c]));
  for (const [k, d] of Object.entries(all)) {
    if (!k.startsWith('dash:') || !d || !(d.expires > Date.now()) || !String(d.links || '').includes(docId)) continue;
    if (!dueAt && d.dueAt) dueAt = d.dueAt;
    for (const c of d.checkpoints || []) if (!cps.has(c.t)) cps.set(c.t, c);
  }
  return { dueAt, checkpoints: [...cps.values()].sort((a, b) => a.t - b.t).slice(0, 8) };
}

// ---------- status ----------
function status(text, progress) {
  const el = clear($('p-status'));
  if (!text) return;
  el.appendChild(h('div', { text }));
  if (progress != null) el.appendChild(h('div', { class: 'progress' }, h('div', { style: `width:${Math.round(progress * 100)}%` })));
}
function empty(text) {
  shown = { docId: null, tabId: null, result: null, ctx: null, raw: null, dueAt: null, checkpoints: [], cp: new Map() };
  $('p-main').hidden = true;
  $('p-doc').textContent = '';
  status(text);
}

// ---------- loading ----------
async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function refresh(force = false) {
  const my = ++seq;
  const tab = await activeTab();
  const f = tab && tab.url ? parseFileUrl(tab.url) : null;
  if (!f) return empty('Open a Google Doc you can edit to see what each student did in it.');
  if (f.kind === KIND.SLIDES) return empty('Google Slides is not summarised yet. Open a Google Doc.');
  if (!force && shown.docId === f.docId && shown.tabId === tab.id && shown.result) return;
  $('p-main').hidden = true;
  $('p-doc').textContent = '';
  status('Connecting to the document…', 0);
  const ctx = await ask(tab.id, { wh: 'context' }).catch(() => null);
  if (my !== seq) return;
  if (!ctx || !ctx.ok) return empty('Reload the Google Doc tab, then press Refresh.');
  try {
    const got = await loadHistory(new DocFetcher(tab.id, ctx, settings.variant), (t, p) => { if (my === seq) status(t, p); }, force ? null : await readCache(ctx.docId));
    if (!got.info.cached) writeCache(ctx.docId, got.info.last, got.raw);
    const prefs = await getDocPrefs(ctx.docId);
    const { dueAt, checkpoints } = await datesFor(ctx.docId, prefs);
    if (my === seq) status('Summarising…', 0.97);
    const r = got.raw;
    const input = {
      pages: r.pages, exportText: r.exportText, exportHtml: r.exportHtml, snapshotBody: r.snapshotBody, tilesBody: r.tilesBody,
      roles: settings.roles || {}, selfId: ctx.ouid, startAsProvided: prefs.startAsProvided !== false,
      schedule: scheduleOf(settings), dueAt, headingsOnly: settings.headingsOnly !== false,
    };
    const result = await analyse(input);
    if (my !== seq) return;
    shown = { docId: ctx.docId, tabId: tab.id, result, ctx, input, dueAt, checkpoints, cp: new Map() };
    status('');
    draw();
    // Words by each checkpoint, one earlier moment at a time.
    for (const c of checkpoints) {
      const then = await analyse({ ...input, asOf: c.t, deleteInclusive: result.diagnostics.deleteInclusive, headingMarks: result.headingMarks });
      if (my !== seq) return;
      shown.cp.set(c.t, then);
      draw();
    }
  } catch (err) {
    if (my === seq) empty(ERRORS[err.code] || ERRORS.FETCH_FAILED);
  }
}

// ---------- drawing ----------
const num = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

let tl = null;
function studentCard(result, e) {
  const total = Object.values(e.catWords || {}).reduce((a, b) => a + b, 0);
  const groups = GROUPS.map((g) => ({ ...g, words: g.cats.reduce((a, c) => a + ((e.catWords || {})[c] || 0), 0) })).filter((g) => g.words);
  const bar = h('div', { class: 'p-bar', role: 'img', 'aria-label': groups.map((g) => `${g.label}: ${pct(g.words / (total || 1))}`).join('; ') },
    groups.map((g) => h('span', { title: `${g.label}: ${num(g.words)} words`, style: `flex:${g.words};background:rgb(var(${g.color}))` })));
  const list = h('ul', { class: 'p-groups' }, groups.map((g) => h('li', {},
    h('i', { style: `background:rgb(var(${g.color}))`, 'aria-hidden': 'true' }), g.label,
    h('span', { class: 'n', text: `${pct(g.words / (total || 1))} · ${plural(g.words, 'word', 'words')}` }))));
  const facts = [
    `Typed ${num(e.typed)} characters`,
    e.chunks ? `added ${plural(e.chunks, 'large chunk', 'large chunks')} (${num(e.chunked)} characters)` : 'no large chunks',
    e.copies ? `copied ${num(e.copied)} characters from elsewhere in this Doc` : null,
    e.deleted ? `deleted ${num(e.deleted)}` : 'nothing deleted',
  ].filter(Boolean).join(' · ');
  const when = e.finalWhen && scheduleOf(settings) ? (() => {
    const w = e.finalWhen, sum = w.school + w.home + w.late;
    if (!sum) return null;
    return [`School ${pct(w.school / sum)}`, `home ${pct(w.home / sum)}`, w.late ? `after the due date ${pct(w.late / sum)}` : null].filter(Boolean).join(' · ');
  })() : null;
  return h('section', { class: 'p-student' },
    h('div', { class: 'p-name' }, h('b', { text: writerLabel(result, e.owner) }),
      h('span', { class: 'hint', text: `${plural(e.words, 'word', 'words')} · ${pct(e.share)} of the document` })),
    total ? bar : null,
    total ? list : h('p', { class: 'p-facts', text: 'None of their text is left in the document.' }),
    e.copiedWords ? h('p', { class: 'p-facts p-copy', text: `⧉ ${plural(e.copiedWords, 'word', 'words')} copied from elsewhere in this Doc (such as their draft), then shown by how they were first written.` }) : null,
    h('p', { class: 'p-facts', text: facts }),
    h('p', { class: 'p-facts', text: `Active ${e.activeMs < 60000 ? 'under a minute' : `about ${duration(e.activeMs)}`} over ${plural(e.sessions, 'session', 'sessions')}${e.lastT ? `; last edit ${fmtTime(e.lastT)}` : ''}.` }),
    when ? h('p', { class: 'p-facts', text: when }) : null,
    tl ? strip(tl, tl.rows.get(e.owner)) : null,
    tl ? h('p', { class: 'p-facts', text: timeFacts(tl.rows.get(e.owner)) }) : null,
    shown.checkpoints.length ? h('p', { class: 'p-facts p-cps' }, checkpointLine(e.owner)) : null,
    h('button', { type: 'button', class: 'link', onclick: () => openFull(e.owner), text: 'See their writing' }));
}

// One student's writing sessions on the shared strip: a block per session
// (yellow when mostly typed, red when mostly large chunks), a red mark at
// each large chunk, a dashed line at the due date, dotted ones at checkpoints.
function strip(tl, row) {
  const W = 300, H = 22;
  const el = svg('svg', { class: 'p-strip', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': row ? timeFacts(row) : 'No writing' });
  el.appendChild(svg('rect', { x: 0, y: 8, width: W, height: 6, rx: 3, class: 'p-track' }));
  for (const x of tl.days) el.appendChild(svg('line', { x1: x * W, x2: x * W, y1: 4, y2: 18, class: 'p-day' }));
  for (const c of tl.checkpoints) el.appendChild(svg('line', { x1: c.x * W, x2: c.x * W, y1: 0, y2: H, class: 'p-cp' }, svg('title', {}, `${c.label || 'Checkpoint'}: ${fmtTime(c.t)}`)));
  if (tl.due != null) el.appendChild(svg('line', { x1: tl.due * W, x2: tl.due * W, y1: 0, y2: H, class: 'p-due' }, svg('title', {}, 'Due date')));
  for (const b of row ? row.blocks : []) {
    const x0 = b.x0 * W, w = Math.max(2.5, (b.x1 - b.x0) * W);
    el.appendChild(svg('rect', { x: x0, y: 6, width: w, height: 10, rx: 2, style: `fill:rgb(var(${b.chunked > b.typed ? '--c-large' : '--c-linear'}))` },
      svg('title', {}, `${b.typed + b.chunked} characters${b.chunked ? `, ${b.chunked} in large chunks` : ''}`)));
  }
  for (const c of row ? row.chunks : []) el.appendChild(svg('line', { x1: c.x * W, x2: c.x * W, y1: 2, y2: 20, style: 'stroke:rgb(var(--c-large))', class: 'p-chunk' }, svg('title', {}, `${c.n} characters at once`)));
  return el;
}

function timeFacts(row) {
  if (!row || !row.total) return 'No writing yet.';
  const bits = [`Wrote on ${plural(row.dayCount, 'day', 'days')}`];
  if (row.lastDay != null) bits.push(`${pct(row.lastDay)} in the 24 hours before it was due`);
  if (row.late) bits.push(`${pct(row.late)} after the due date`);
  return `${bits.join(' · ')}.`;
}

function checkpointLine(owner) {
  const parts = shown.checkpoints.map((c) => {
    const r = shown.cp.get(c.t);
    const ed = r && r.contributions.editors.find((x) => x.owner === owner);
    return `${c.label || 'Checkpoint'} (${new Date(c.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}): ${r ? plural(ed ? ed.words || 0 : 0, 'word', 'words') : '…'}`;
  });
  const now = shown.result.contributions.editors.find((x) => x.owner === owner);
  return `By ${parts.join(' → ')} → now ${plural(now ? now.words || 0 : 0, 'word', 'words')}`;
}

function draw() {
  const { result, ctx } = shown;
  $('p-doc').textContent = ctx.title || 'Untitled document';
  const students = result.contributions.editors.filter((e) => e.role === 'student').sort((a, b) => (b.words || 0) - (a.words || 0));
  const s = result.summary;
  $('p-overview').textContent = students.length
    ? `${plural(students.length, 'student', 'students')} wrote ${pct(s.studentShare)} of this document (${plural(s.studentWords, 'word', 'words')}).${result.summary.completeness === 'verified' ? '' : ' Parts of the history are unclear; the full view marks them.'}`
    : 'No student writing in this document yet.';
  tl = timelineModel(students, { dueAt: shown.dueAt, checkpoints: shown.checkpoints });
  const head = clear($('p-when'));
  if (tl) {
    const d = (t) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    head.append(h('div', { class: 'p-range' }, h('span', { text: d(tl.from) }), h('span', { text: d(tl.to) })),
      h('p', { class: 'hint', text: `Each strip below runs across these dates: yellow blocks are writing sessions, red marks are large chunks${shown.dueAt ? ', the dashed line is the due date' : ''}${shown.checkpoints.length ? ', dotted lines are checkpoints' : ''}.` }));
  }
  const list = clear($('p-students'));
  for (const e of students) list.appendChild(studentCard(result, e));
  $('p-main').hidden = false;
}

// The full view for this Doc's tab, optionally showing only one student.
async function openFull(focus) {
  if (shown.tabId == null) return;
  const key = crypto.randomUUID();
  await chrome.storage.session.set({ [`job:${key}`]: { tabId: shown.tabId, expires: Date.now() + JOB_TTL_MS, ...(focus ? { focus } : {}) } });
  const tab = await chrome.tabs.get(shown.tabId).catch(() => null);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html#k=${key}`), index: tab ? tab.index + 1 : undefined, openerTabId: shown.tabId });
}

$('p-refresh').addEventListener('click', () => refresh(true));
$('p-full').addEventListener('click', () => openFull(''));
chrome.tabs.onActivated.addListener(() => refresh());
chrome.tabs.onUpdated.addListener((id, info, tab) => { if (tab.active && (info.url || info.status === 'complete')) refresh(); });
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local') return;
  // A due date or checkpoint set in the full view or a dashboard.
  if (shown.docId && Object.keys(ch).some((k) => k === `doc:${shown.docId}` || k.startsWith('dash:'))) { shown.result = null; refresh(); return; }
  if (!ch.settings) return;
  const before = JSON.stringify([settings.roles, settings.schoolOn, settings.schedule, settings.headingsOnly]);
  settings = { ...structuredClone(DEFAULT_SETTINGS), ...(ch.settings.newValue || {}) };
  applyPalette(settings);
  if (before !== JSON.stringify([settings.roles, settings.schoolOn, settings.schedule, settings.headingsOnly])) { shown.result = null; refresh(); }
});

(async () => {
  await loadSettings();
  refresh();
})();
