// The viewer: loads one document's history through its tab, analyses it in a
// worker, and draws the heatmap. Everything stays in this browser.

import { h, clear } from './dom.js';
import { ask, DocFetcher, FetchError } from './fetcher.js';
import { ERRORS } from '../lib/wording.js';
import { expiresAt, expiredKeys, DEFAULT_TTL_MIN, isExpired } from '../lib/ttl.js';
import {
  renderBanners, renderTabs, renderDoc, markSelected, renderSummary, renderLegend, renderTimeline, renderInspector, renderPrintExtra,
} from './render.js';
import { ReplayUI } from './replay-ui.js';
import { renderTesting, downloadRaw } from './testing.js';

const $ = (id) => document.getElementById(id);
const VERSION = chrome.runtime.getManifest().version;
const CACHE_MAX_CHARS = 8_000_000; // stay well inside storage.session's 10 MB

const state = {
  tabId: null, ctx: null, settings: { ttlMin: DEFAULT_TTL_MIN, showButton: true, showTesting: false, variant: null },
  result: null, raw: null, fetchInfo: null, mode: 'teacher', tabIndex: 0, selected: null, pins: new Set(), note: '',
};

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
function work(type, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }); });
}

// ---------- status ----------
function status(text, progress) {
  const el = clear($('status'));
  if (!text) return;
  el.appendChild(h('div', { text }));
  if (progress != null) el.appendChild(h('div', { class: 'progress' }, h('div', { style: `width:${Math.round(progress * 100)}%` })));
}
function fail(code, detail) {
  const el = clear($('status'));
  el.appendChild(h('div', { class: 'error', text: ERRORS[code] || ERRORS.FETCH_FAILED }));
  if (detail && state.settings.showTesting) el.appendChild(h('div', { class: 'hint', text: `Detail: ${code} ${detail}` }));
  $('main').hidden = true;
}

// ---------- storage ----------
async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    Object.assign(state.settings, settings || {});
  } catch { /* defaults */ }
}
async function saveSettings() {
  await chrome.storage.local.set({ settings: state.settings });
}
async function sweep() {
  const items = await chrome.storage.session.get(null);
  const dead = expiredKeys(items, Date.now());
  if (dead.length) await chrome.storage.session.remove(dead);
}
async function readCache(docId) {
  const key = `cache:${docId}`;
  const got = (await chrome.storage.session.get(key))[key];
  return got && !isExpired(got, Date.now()) ? got : null;
}
async function writeCache(docId, lastRev, raw) {
  const entry = { expires: expiresAt(Date.now(), state.settings.ttlMin), lastRev, raw };
  if (JSON.stringify(entry).length > CACHE_MAX_CHARS) return;
  try { await chrome.storage.session.set({ [`cache:${docId}`]: entry }); } catch { /* over quota: just don't cache */ }
}
async function loadNote(docId) {
  const key = `note:${docId}`;
  const got = (await chrome.storage.session.get(key))[key];
  return got && !isExpired(got, Date.now()) ? got.text : '';
}
async function saveNote(docId, text) {
  await chrome.storage.session.set({ [`note:${docId}`]: { text, expires: expiresAt(Date.now(), state.settings.ttlMin) } });
}

// ---------- loading ----------
async function load({ refresh = false } = {}) {
  $('btn-print').disabled = true;
  $('btn-refresh').disabled = true;
  status('Connecting to the document…', 0);
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  const job = key ? (await chrome.storage.session.get(`job:${key}`))[`job:${key}`] : null;
  if (!job) return fail('TAB_CLOSED');
  state.tabId = job.tabId;

  const ctx = await ask(state.tabId, { wh: 'context' }).catch(() => ({ ok: false, code: 'NOT_A_DOC' }));
  if (!ctx.ok) return fail(ctx.code || 'NOT_A_DOC');
  state.ctx = ctx;
  $('doc-title').textContent = ctx.title || 'Untitled document';
  document.title = `${ctx.title || 'Document'} · Writing Heatmap`;

  const t0 = performance.now();
  const fetcher = new DocFetcher(state.tabId, ctx, state.settings.variant);
  let raw, info;
  try {
    status('Checking access to the history…', 0.02);
    const variant = await fetcher.probe();
    if (state.settings.variant !== variant.id) { state.settings.variant = variant.id; saveSettings(); }
    status('Finding the latest revision…', 0.05);
    const last = await fetcher.lastRevision();
    if (!last.last) throw new FetchError('NO_HISTORY');
    const cached = refresh ? null : await readCache(ctx.docId);
    if (cached && cached.lastRev === last.last) {
      raw = cached.raw;
    } else {
      const pages = await fetcher.pages(last.last, (done, total) => status(`Loading history: revision ${done.toLocaleString()} of ${total.toLocaleString()}…`, 0.05 + 0.85 * (done / total)));
      status('Checking against the current text…', 0.92);
      const exportText = await fetcher.exportText();
      const snapshotBody = exportText == null ? await fetcher.snapshotAt(last.last) : null;
      raw = { pages, tilesBody: last.tilesBody, exportText, snapshotBody };
      writeCache(ctx.docId, last.last, raw);
    }
    info = { variant: variant.id, probes: fetcher.probes, last: last.last, fromTiles: last.fromTiles, firstRev: last.firstRev, cached: !!(cached && cached.lastRev === last.last) };
  } catch (err) {
    return fail(err.code || 'FETCH_FAILED', err.detail);
  }
  info.fetchMs = Math.round(performance.now() - t0);

  status('Analysing…', 0.96);
  try {
    state.result = await work('analyze', { input: { pages: raw.pages, exportText: raw.exportText, snapshotBody: raw.snapshotBody, tilesBody: raw.tilesBody } });
  } catch (err) {
    return fail(err.code === 'NOT_JSON' || err.code === 'EMPTY_BODY' ? 'FORMAT_CHANGED' : 'FETCH_FAILED', err.message);
  }
  state.raw = raw;
  state.fetchInfo = info;
  state.selected = null;
  state.pins = new Set();
  state.tabIndex = 0;
  state.note = await loadNote(ctx.docId);
  $('note').value = state.note;
  status('');
  $('main').hidden = false;
  $('btn-print').disabled = false;
  $('btn-refresh').disabled = false;
  draw();
}

// ---------- drawing ----------
function currentTab() { return state.result.tabs[state.tabIndex]; }
function findSpan(id) {
  for (const tab of state.result.tabs) for (const sp of tab.spans) if (sp.id === id) return { sp, tab };
  return null;
}
function actorName(id) {
  const a = state.result.actors.find((x) => x.id === id);
  if (!a) return 'Someone';
  return a.name ? `${a.label} (${a.name})` : a.label;
}

const replay = new ReplayUI($('replay'), actorName);

function draw() {
  const r = state.result;
  if (!r) return;
  document.body.classList.toggle('student', state.mode === 'student');
  renderBanners($('banners'), r);
  renderTabs($('tab-picker'), r, state.tabIndex, (k) => { state.tabIndex = k; state.selected = null; draw(); });
  renderDoc($('doc'), currentTab(), state.mode, select);
  renderSummary($('summary'), $('share-bar'), r, state.mode);
  renderLegend($('legend'), r, state.mode);
  drawSelection();
  $('testing-card').hidden = !state.settings.showTesting || state.mode === 'student';
  if (state.settings.showTesting) {
    renderTesting($('testing'), r, state.fetchInfo, (name) => downloadRaw(state.raw, state.fetchInfo, name, VERSION));
  }
}

function drawSelection() {
  const found = state.selected ? findSpan(state.selected) : null;
  markSelected($('doc'), state.selected);
  renderTimeline($('timeline'), state.result, found ? found.sp.events : []);
  renderInspector($('inspector'), state.result, found && found.sp, found && found.tab, state.mode, {
    pinned: found && state.pins.has(found.sp.id),
    replay: async () => {
      const w = await work('replay', { tab: found.tab.id, events: found.sp.events });
      replay.open(w.windows);
    },
    pin: () => {
      if (state.pins.has(found.sp.id)) state.pins.delete(found.sp.id); else state.pins.add(found.sp.id);
      drawSelection();
    },
  });
}

function select(id) {
  state.selected = id;
  drawSelection();
  $('inspector-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- controls ----------
$('student-mode').addEventListener('change', (e) => { state.mode = e.target.checked ? 'student' : 'teacher'; draw(); });
$('btn-refresh').addEventListener('click', () => load({ refresh: true }));
$('note').addEventListener('input', (e) => {
  state.note = e.target.value;
  if (state.ctx) saveNote(state.ctx.docId, state.note);
});
$('btn-print').addEventListener('click', () => {
  const ok = confirm('A printed or saved report is part of the student’s education record. Store and share it the way your school handles student work.\n\nContinue to print?');
  if (!ok) return;
  const pins = [...state.pins].map(findSpan).filter(Boolean);
  renderPrintExtra($('print-pins'), $('print-note'), $('print-method'), state.result, pins, state.mode === 'student' ? '' : state.note, state.mode);
  window.print();
});

const dlg = $('settings');
$('btn-settings').addEventListener('click', () => {
  $('set-ttl').value = String(state.settings.ttlMin);
  $('set-button').checked = state.settings.showButton !== false;
  $('set-testing').checked = !!state.settings.showTesting;
  $('set-cleared').textContent = '';
  dlg.showModal();
});
$('set-close').addEventListener('click', async () => {
  state.settings.ttlMin = Number($('set-ttl').value) || DEFAULT_TTL_MIN;
  state.settings.showButton = $('set-button').checked;
  state.settings.showTesting = $('set-testing').checked;
  await saveSettings();
  dlg.close();
  draw();
});
$('set-clear').addEventListener('click', async () => {
  const items = await chrome.storage.session.get(null);
  // Keep only the job keys that let open viewer tabs reconnect.
  await chrome.storage.session.remove(Object.keys(items).filter((k) => !k.startsWith('job:')));
  state.note = '';
  $('note').value = '';
  $('set-cleared').textContent = 'Cleared cached analyses and notes.';
});

(async () => {
  await loadSettings();
  await sweep();
  await load();
})();
