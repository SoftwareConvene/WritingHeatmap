// The viewer: loads one document's history through its tab, analyses it in a
// worker, and draws the heatmap. Everything stays in this browser.

import { h, clear } from './dom.js';
import { ask, DocFetcher, FetchError } from './fetcher.js';
import { ERRORS } from '../lib/wording.js';
import { expiresAt, expiredKeys, DEFAULT_TTL_MIN, isExpired } from '../lib/ttl.js';
import {
  renderBanners, renderTabs, renderDoc, markSelected, renderSummary, renderLegend, renderTimeline, renderInspector, renderPrintExtra,
  renderContrib, writerLabel, renderCompare,
} from './render.js';
import { ReplayUI } from './replay-ui.js';
import { renderTesting, downloadRaw } from './testing.js';
import { Finder, renderSections } from './find.js';

const $ = (id) => document.getElementById(id);
const VERSION = chrome.runtime.getManifest().version;
const CACHE_MAX_CHARS = 8_000_000; // stay well inside storage.session's 10 MB
const SLOW_MS = 45_000;            // offer to stop an analysis that runs this long

const state = {
  tabId: null, ctx: null,
  settings: { ttlMin: DEFAULT_TTL_MIN, showButton: true, showTesting: false, variant: null, roles: {} },
  result: null, raw: null, fetchInfo: null, mode: 'teacher', tabIndex: 0, selected: null, pins: new Set(), note: '',
  view: { colorBy: 'process', focus: '', page: 'doc' },
  startAsProvided: true,
};

// ---------- worker ----------
// A worker that dies (out of memory, a crash) sends no message; onerror turns
// that into a visible failure instead of a page stuck on "Analysing".
let worker = null;
let nextId = 1;
const waiting = new Map();
function startWorker() {
  worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = (e) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.result); else w.reject(Object.assign(new Error(e.data.message), { code: e.data.code }));
  };
  const die = (code) => () => {
    for (const w of waiting.values()) w.reject(Object.assign(new Error(code), { code }));
    waiting.clear();
    worker.terminate();
    startWorker();
  };
  worker.onerror = die('ANALYSIS_CRASHED');
  worker.onmessageerror = die('ANALYSIS_CRASHED');
}
startWorker();
function work(type, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }); });
}
function stopWork() {
  for (const w of waiting.values()) w.reject(Object.assign(new Error('STOPPED'), { code: 'ANALYSIS_STOPPED' }));
  waiting.clear();
  worker.terminate();
  startWorker();
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
  if (state.raw && state.settings.showTesting && /^ANALYSIS_/.test(code)) {
    el.appendChild(h('button', { type: 'button', onclick: () => downloadRaw(state.raw, state.fetchInfo, 'stuck', VERSION), text: 'Save raw history for testing (your own test documents only)' }));
  }
  $('main').hidden = true;
}

// ---------- storage ----------
async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    Object.assign(state.settings, settings || {});
    state.settings.roles ||= {};
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

// ---------- analysis ----------
// Runs the worker with a visible clock, and a Stop button once it is slow.
async function analyse(label) {
  const t0 = Date.now();
  const tick = () => {
    const s = Math.round((Date.now() - t0) / 1000);
    status(`${label}${s >= 2 ? ` (${s} s)` : ''}`, 0.96);
    if (Date.now() - t0 > SLOW_MS) {
      $('status').appendChild(h('p', { class: 'hint', text: 'This document’s history is taking unusually long. You can keep waiting or stop.' }));
      $('status').appendChild(h('button', { type: 'button', onclick: stopWork, text: 'Stop' }));
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  try {
    return await work('analyze', {
      input: {
        pages: state.raw.pages, exportText: state.raw.exportText, snapshotBody: state.raw.snapshotBody, tilesBody: state.raw.tilesBody,
        roles: state.settings.roles, selfId: state.ctx && state.ctx.ouid, startAsProvided: state.startAsProvided,
      },
    });
  } finally {
    clearInterval(timer);
  }
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

  const opts = (await chrome.storage.session.get(`opts:${ctx.docId}`))[`opts:${ctx.docId}`];
  state.startAsProvided = opts && !isExpired(opts, Date.now()) ? opts.startAsProvided !== false : true;

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
  state.raw = raw;
  state.fetchInfo = info;

  try {
    state.result = await analyse(`Analysing ${info.last.toLocaleString()} revisions…`);
  } catch (err) {
    const code = err.code === 'NOT_JSON' || err.code === 'EMPTY_BODY' ? 'FORMAT_CHANGED' : (err.code || 'ANALYSIS_FAILED');
    return fail(ERRORS[code] ? code : 'ANALYSIS_FAILED', err.message);
  }
  state.selected = null;
  state.pins = new Set();
  state.tabIndex = 0;
  state.view.focus = '';
  state.note = await loadNote(ctx.docId);
  $('note').value = state.note;
  status('');
  $('main').hidden = false;
  $('btn-print').disabled = false;
  $('btn-refresh').disabled = false;
  draw();
}

// The per-document choice about a document's starting text, kept for the
// session like the teacher's notes.
async function setStartText(asProvided) {
  state.startAsProvided = asProvided;
  if (state.ctx) await chrome.storage.session.set({ [`opts:${state.ctx.docId}`]: { startAsProvided: asProvided, expires: expiresAt(Date.now(), state.settings.ttlMin) } });
  try {
    state.result = await analyse('Updating…');
  } catch (err) {
    return fail(err.code || 'ANALYSIS_FAILED', err.message);
  }
  status('');
  if (state.selected && !findSpan(state.selected)) state.selected = null;
  draw();
}

// A role change re-runs the analysis on the history already loaded.
async function setRole(actorId, role) {
  if (role === 'student') delete state.settings.roles[actorId];
  else state.settings.roles[actorId] = role;
  await saveSettings();
  try {
    state.result = await analyse('Updating…');
  } catch (err) {
    return fail(err.code || 'ANALYSIS_FAILED', err.message);
  }
  status('');
  if (state.selected && !findSpan(state.selected)) state.selected = null;
  if (state.view.focus && !ownerExists(state.view.focus)) state.view.focus = '';
  draw();
}

function ownerExists(owner) {
  return state.result.tabs.some((t) => t.spans.some((sp) => sp.owner === owner));
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
const finder = new Finder($('doc'), $('find'), $('find-count'), $('find-prev'), $('find-next'));

function draw() {
  const r = state.result;
  if (!r) return;
  document.body.classList.toggle('student', state.mode === 'student');
  document.body.classList.toggle('page-compare', state.view.page === 'compare');
  $('page-doc').setAttribute('aria-selected', String(state.view.page === 'doc'));
  $('page-compare').setAttribute('aria-selected', String(state.view.page === 'compare'));
  $('compare').hidden = state.view.page !== 'compare';
  renderCompare($('compare'), r, state.mode, showWriter);
  $('by-process').setAttribute('aria-pressed', String(state.view.colorBy === 'process'));
  $('by-writer').setAttribute('aria-pressed', String(state.view.colorBy === 'writer'));
  renderBanners($('banners'), r, {
    startProvided: { label: 'Count it as the student’s instead', run: () => setStartText(false) },
    startStudent: { label: 'Treat it as provided', run: () => setStartText(true) },
  });
  renderTabs($('tab-picker'), r, state.tabIndex, (k) => { state.tabIndex = k; state.selected = null; draw(); });
  renderDoc($('doc'), currentTab(), r, state.mode, state.view, select);
  renderSections($('sections'), $('doc'));
  $('edit-count').textContent = '';
  finder.refresh();
  renderFocus();
  renderSummary($('summary'), $('share-bar'), r, state.mode);
  renderContrib($('contrib'), r, state.mode, state.view, setRole, (owner) => { state.view.focus = owner; draw(); });
  renderLegend($('legend'), r, state.mode, state.view);
  drawSelection();
  $('testing-card').hidden = !state.settings.showTesting || state.mode === 'student';
  if (state.settings.showTesting) {
    renderTesting($('testing'), r, state.fetchInfo, (name) => downloadRaw(state.raw, state.fetchInfo, name, VERSION));
  }
}

// From a student's card: back to the document, showing only their text in their colour.
function showWriter(owner) {
  state.view = { ...state.view, page: 'doc', focus: owner, colorBy: 'writer' };
  draw();
  $('doc').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderFocus() {
  const el = clear($('focus-note'));
  el.hidden = !state.view.focus;
  if (!state.view.focus) return;
  el.append(`Showing only: ${writerLabel(state.result, state.view.focus)} `,
    h('button', { type: 'button', class: 'link', onclick: () => { state.view.focus = ''; draw(); }, text: 'Show everyone' }));
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

// "Next edit": every passage that is not plain in-place writing and not
// provided or teacher text, in reading order, within the writer shown.
const QUIET = new Set(['linear', 'provided', 'teacher']);
function editedPassages() {
  return [...$('doc').querySelectorAll('.ps')].filter((el) => !QUIET.has(el.dataset.cat) && !el.classList.contains('dim'));
}
function stepEdit(d) {
  const list = editedPassages();
  if (!list.length) { $('edit-count').textContent = 'No edits'; return; }
  let k = list.findIndex((el) => el.dataset.id === state.selected);
  if (k < 0) {
    // Nothing selected yet: start from what is on screen.
    const y = window.innerHeight / 3;
    k = list.findIndex((el) => el.getBoundingClientRect().top > y);
    k = d > 0 ? (k < 0 ? 0 : k) : (k <= 0 ? list.length - 1 : k - 1);
  } else {
    k = (k + d + list.length) % list.length;
  }
  const el = list[k];
  select(el.dataset.id);
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.focus({ preventScroll: true });
  $('edit-count').textContent = `${k + 1} of ${list.length}`;
}

function select(id) {
  state.selected = id;
  drawSelection();
  $('inspector-card').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- controls ----------
$('student-mode').addEventListener('change', (e) => { state.mode = e.target.checked ? 'student' : 'teacher'; draw(); });
$('edit-next').addEventListener('click', () => stepEdit(1));
$('edit-prev').addEventListener('click', () => stepEdit(-1));
// The header's height changes as it wraps; the sticky toolbar sits just under it.
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${document.querySelector('.top').offsetHeight}px`)).observe(document.querySelector('.top'));
$('page-doc').addEventListener('click', () => { state.view.page = 'doc'; draw(); });
$('page-compare').addEventListener('click', () => { state.view.page = 'compare'; draw(); });
$('by-process').addEventListener('click', () => { state.view.colorBy = 'process'; draw(); });
$('by-writer').addEventListener('click', () => { state.view.colorBy = 'writer'; draw(); });
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
  const students = state.result.contributions.editors.filter((e) => e.role === 'student').length;
  $('print-compare-wrap').hidden = students < 2;
  renderCompare($('print-compare'), state.result, state.mode, () => {});
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
  state.settings.roles = {};
  await saveSettings();
  state.note = '';
  $('note').value = '';
  $('set-cleared').textContent = 'Cleared cached analyses, notes and editor roles.';
});

(async () => {
  await loadSettings();
  await sweep();
  await load();
})();
