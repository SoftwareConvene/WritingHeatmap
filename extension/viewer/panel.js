// The side panel beside a Google Doc: for each student, a short summary of
// how their text went in (added in large chunks, written straight through,
// retyped, revised). It follows whichever tab is active, reads the history
// the same way the viewer does, and reuses the viewer's session cache.

import { h, clear, fmtTime } from './dom.js';
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
let shown = { docId: null, tabId: null, result: null, ctx: null };
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

// ---------- status ----------
function status(text, progress) {
  const el = clear($('p-status'));
  if (!text) return;
  el.appendChild(h('div', { text }));
  if (progress != null) el.appendChild(h('div', { class: 'progress' }, h('div', { style: `width:${Math.round(progress * 100)}%` })));
}
function empty(text) {
  shown = { docId: null, tabId: null, result: null, ctx: null };
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
    if (my === seq) status('Summarising…', 0.97);
    const r = got.raw;
    const result = await analyse({
      pages: r.pages, exportText: r.exportText, exportHtml: r.exportHtml, snapshotBody: r.snapshotBody, tilesBody: r.tilesBody,
      roles: settings.roles || {}, selfId: ctx.ouid, startAsProvided: prefs.startAsProvided !== false,
      schedule: scheduleOf(settings), dueAt: prefs.dueAt || null, headingsOnly: settings.headingsOnly !== false,
    });
    if (my !== seq) return;
    shown = { docId: ctx.docId, tabId: tab.id, result, ctx };
    status('');
    draw();
  } catch (err) {
    if (my === seq) empty(ERRORS[err.code] || ERRORS.FETCH_FAILED);
  }
}

// ---------- drawing ----------
const num = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

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
    e.deleted ? `deleted ${num(e.deleted)}` : 'nothing deleted',
  ].join(' · ');
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
    h('p', { class: 'p-facts', text: facts }),
    h('p', { class: 'p-facts', text: `Active ${e.activeMs < 60000 ? 'under a minute' : `about ${duration(e.activeMs)}`} over ${plural(e.sessions, 'session', 'sessions')}${e.lastT ? `; last edit ${fmtTime(e.lastT)}` : ''}.` }),
    when ? h('p', { class: 'p-facts', text: when }) : null,
    h('button', { type: 'button', class: 'link', onclick: () => openFull(e.owner), text: 'See their writing' }));
}

function draw() {
  const { result, ctx } = shown;
  $('p-doc').textContent = ctx.title || 'Untitled document';
  const students = result.contributions.editors.filter((e) => e.role === 'student').sort((a, b) => (b.words || 0) - (a.words || 0));
  const s = result.summary;
  $('p-overview').textContent = students.length
    ? `${plural(students.length, 'student', 'students')} wrote ${pct(s.studentShare)} of this document (${plural(s.studentWords, 'word', 'words')}).${result.summary.completeness === 'verified' ? '' : ' Parts of the history are unclear; the full view marks them.'}`
    : 'No student writing in this document yet.';
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
  if (area !== 'local' || !ch.settings) return;
  const before = JSON.stringify([settings.roles, settings.schoolOn, settings.schedule, settings.headingsOnly]);
  settings = { ...structuredClone(DEFAULT_SETTINGS), ...(ch.settings.newValue || {}) };
  applyPalette(settings);
  if (before !== JSON.stringify([settings.roles, settings.schoolOn, settings.schedule, settings.headingsOnly])) { shown.result = null; refresh(); }
});

(async () => {
  await loadSettings();
  refresh();
})();
