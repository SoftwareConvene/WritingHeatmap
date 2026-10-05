// The viewer: loads one document's history (through its tab, or directly when
// opened from the class dashboard), analyzes it in a worker, and draws the
// heatmap. Everything stays in this browser.

import { h, clear } from './dom.js';
import { ask, DocFetcher, loadHistory } from './fetcher.js';
import { directGet, directContext, withBackgroundTab } from './net.js';
import { ERRORS } from '../lib/wording.js';
import { expiresAt, expiredKeys, isExpired } from '../lib/ttl.js';
import {
  renderBanners, renderTabs, renderDoc, markSelected, renderSummary, renderLegend, renderTimeline, renderInspector, renderPrintExtra,
  renderContrib, writerLabel, renderCompare, renderStudentPages,
} from './render.js';
import { ReplayUI } from './replay-ui.js';
import { renderTesting, downloadRaw, renderSlidesProbe } from './testing.js';
import { Finder, renderSections } from './find.js';
import { AsOfSlider, renderCheckpoints } from './time.js';
import { DEFAULT_SETTINGS, getDocPrefs, setDocPrefs, sweepDocPrefs, scheduleOf, toLocalInput, applyPalette, renderSetupNudge, openSetup } from './prefs.js';

const $ = (id) => document.getElementById(id);
const VERSION = chrome.runtime.getManifest().version;
const CACHE_MAX_CHARS = 8_000_000; // stay well inside storage.session's 10 MB
const SLOW_MS = 45_000;            // offer to stop an analysis that runs this long
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const state = {
  ctx: null,
  settings: structuredClone(DEFAULT_SETTINGS),
  prefs: { startAsProvided: true, dueAt: null, checkpoints: [] },
  full: null,      // analysis of the whole history
  result: null,    // what is on screen: the full analysis, or an "as of" one
  asOf: null,
  cpResults: [],
  raw: null, fetchInfo: null, mode: 'teacher', tabIndex: 0, selected: null, pins: new Set(), note: '',
  view: { colorBy: 'process', focus: '', page: 'doc' },
};

// ---------- worker ----------
// A worker that dies (out of memory, a crash) sends no message; onerror turns
// that into a visible failure instead of a page stuck on "Analyzing".
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
    state.settings.schedule ||= structuredClone(DEFAULT_SETTINGS.schedule);
  } catch { /* defaults */ }
  applyPalette(state.settings);
  renderSetupNudge($('setup-nudge'), state.settings);
}
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.settings) return;
  // Changes made elsewhere (the setup guide, another view) join this page's
  // copy, so a later save here does not undo them.
  Object.assign(state.settings, ch.settings.newValue || {});
  applyPalette(state.settings);
  renderSetupNudge($('setup-nudge'), state.settings);
});
async function saveSettings() {
  await chrome.storage.local.set({ settings: state.settings });
}
async function sweep() {
  const items = await chrome.storage.session.get(null);
  const dead = expiredKeys(items, Date.now());
  if (dead.length) await chrome.storage.session.remove(dead);
  await sweepDocPrefs();
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
function baseInput() {
  return {
    pages: state.raw.pages, exportText: state.raw.exportText, exportHtml: state.raw.exportHtml, snapshotBody: state.raw.snapshotBody, tilesBody: state.raw.tilesBody,
    roles: state.settings.roles, selfId: state.ctx && state.ctx.ouid, startAsProvided: state.prefs.startAsProvided !== false,
    schedule: scheduleOf(state.settings), dueAt: state.prefs.dueAt || null, headingsOnly: state.settings.headingsOnly !== false,
  };
}

// The full history, with a visible clock and a Stop button once it is slow.
async function analyzeFull(label) {
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
    return await work('analyze', { input: baseInput() });
  } finally {
    clearInterval(timer);
  }
}

// The history up to one moment. Reuses the full analysis's reading of the data.
function analyzeAt(asOf) {
  return work('analyze', { input: { ...baseInput(), asOf, deleteInclusive: state.full.diagnostics.deleteInclusive, headingMarks: state.full.headingMarks }, light: true });
}

// After anything that changes how text is classified: redo the full view,
// then the "as of" view if one is showing. Checkpoints recompute on demand.
async function reanalyze() {
  try {
    state.full = await analyzeFull('Updating…');
    state.result = state.asOf == null ? state.full : await analyzeAt(state.asOf);
    state.cpResults = [];
  } catch (err) {
    return fail(err.code || 'ANALYSIS_FAILED', err.message);
  }
  status('');
  if (state.selected && !findSpan(state.selected)) state.selected = null;
  if (state.view.focus && !ownerExists(state.view.focus)) state.view.focus = '';
  slider.load(state.full, state.prefs.dueAt, state.asOf);
  draw();
}

// ---------- loading ----------
// A job is { tabId } from the button on a document, or { docId, u, title }
// from the class dashboard, which has no tab for the document.
async function fetchFor(job, refresh) {
  const cachedFor = async (docId) => (refresh ? null : readCache(docId));
  const viaTab = async (tabId, ctx) => {
    const got = await loadHistory(new DocFetcher(tabId, ctx, state.settings.variant), status, await cachedFor(ctx.docId));
    return { ctx, ...got };
  };
  if (job.tabId != null) {
    const ctx = await ask(job.tabId, { wh: 'context' }).catch(() => ({ ok: false, code: 'NOT_A_DOC' }));
    if (!ctx.ok) return { error: ctx.code || 'NOT_A_DOC' };
    return viaTab(job.tabId, ctx);
  }
  // Ask Google directly with the teacher's own sign-in; if that is refused,
  // read the document through a background tab that closes afterwards.
  const ctx = await directContext(job.docId, job.u || 0);
  if (ctx.ok) {
    try {
      const got = await loadHistory(new DocFetcher(directGet, ctx, state.settings.variant), status, await cachedFor(ctx.docId));
      return { ctx, ...got };
    } catch { /* fall through to the background tab */ }
  }
  status('Opening the document in the background…', 0.02);
  const got = await withBackgroundTab(job.docId, job.u || 0, async (tabId, c) => ({ ok: true, ...(await viaTab(tabId, c)) }));
  return got.ok ? got : { error: got.code || 'NO_ACCESS' };
}

async function load({ refresh = false } = {}) {
  $('btn-print').disabled = true;
  $('btn-refresh').disabled = true;
  status('Connecting to the document…', 0);
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  const job = key ? (await chrome.storage.session.get(`job:${key}`))[`job:${key}`] : null;
  if (!job) return fail('TAB_CLOSED');

  // A Google Slides deck: probe and save only, until its format is known.
  if (job.tabId != null) {
    const ctx = await ask(job.tabId, { wh: 'context' }).catch(() => null);
    if (ctx && ctx.ok && ctx.kind === 'presentation') return loadSlides(job, ctx);
  }

  const t0 = performance.now();
  let got;
  try {
    got = await fetchFor(job, refresh);
  } catch (err) {
    return fail(err.code || 'FETCH_FAILED', err.detail);
  }
  if (got.error) return fail(got.error);
  const { ctx, raw, info } = got;
  if (state.settings.variant !== info.variant) { state.settings.variant = info.variant; saveSettings(); }
  if (!info.cached) writeCache(ctx.docId, info.last, raw);
  state.ctx = ctx;
  const title = ctx.title || job.title || 'Untitled document';
  $('doc-title').textContent = title;
  document.title = `${title} · Writing Heatmap`;
  info.fetchMs = Math.round(performance.now() - t0);
  state.raw = raw;
  state.fetchInfo = info;
  state.prefs = await getDocPrefs(ctx.docId);
  $('due-at').value = toLocalInput(state.prefs.dueAt);

  try {
    state.full = await analyzeFull(`Analyzing ${(info.last || 0).toLocaleString()} revisions…`);
  } catch (err) {
    const code = err.code === 'NOT_JSON' || err.code === 'EMPTY_BODY' ? 'FORMAT_CHANGED' : (err.code || 'ANALYSIS_FAILED');
    return fail(ERRORS[code] ? code : 'ANALYSIS_FAILED', err.message);
  }
  state.result = state.full;
  state.asOf = null;
  // Opened from a class checkpoint: show the document as it stood then.
  if (typeof job.asOf === 'number') {
    try { state.result = await analyzeAt(job.asOf); state.asOf = job.asOf; } catch { state.result = state.full; }
  }
  state.cpResults = [];
  state.selected = null;
  state.pins = new Set();
  state.tabIndex = 0;
  state.view.focus = job.focus || '';
  if (job.page) state.view.page = job.page;
  state.jumpSection = job.section || null;
  state.note = await loadNote(ctx.docId);
  $('note').value = state.note;
  status('');
  $('main').hidden = false;
  $('btn-print').disabled = false;
  $('btn-refresh').disabled = false;
  slider.load(state.full, state.prefs.dueAt, state.asOf);
  draw();
}

async function loadSlides(job, ctx) {
  state.ctx = ctx;
  const title = ctx.title || 'Untitled presentation';
  $('doc-title').textContent = title;
  document.title = `${title} · Writing Heatmap`;
  const fetcher = new DocFetcher(job.tabId, ctx, null);
  let raw = { pages: [], tilesBody: null, exportText: null, snapshotBody: null };
  let info, error = null;
  try {
    ({ raw, info } = await loadHistory(fetcher, status));
  } catch (err) {
    error = err.code || 'FETCH_FAILED';
    info = { variant: fetcher.variant ? fetcher.variant.id : null, probes: fetcher.probes, last: null, fromTiles: null, firstRev: null };
    raw.exportText = await fetcher.exportText().catch(() => null);
  }
  status('');
  renderSlidesProbe($('slides'), { raw, info, error }, (name) => downloadRaw(raw, info, name, VERSION, 'presentation'));
  $('slides').hidden = false;
  $('btn-refresh').disabled = false;
}

// ---------- per-document choices ----------
async function setStartText(asProvided) {
  state.prefs = await setDocPrefs(state.ctx.docId, { startAsProvided: asProvided });
  await reanalyze();
}

async function setRole(actorId, role) {
  if (role === 'student') delete state.settings.roles[actorId];
  else state.settings.roles[actorId] = role;
  await saveSettings();
  await reanalyze();
}

function ownerExists(owner) {
  return state.result.tabs.some((t) => t.spans.some((sp) => sp.owner === owner));
}

// ---------- "as of" ----------
const slider = new AsOfSlider(async (asOf) => {
  state.asOf = asOf;
  if (!state.full) return;
  let next = state.full;
  if (asOf != null) {
    $('asof-when').classList.add('busy');
    try { next = await analyzeAt(asOf); } catch (err) { return fail(err.code || 'ANALYSIS_FAILED', err.message); } finally { $('asof-when').classList.remove('busy'); }
    if (state.asOf !== asOf) return; // a newer pick is on its way
  }
  state.result = next;
  if (state.selected && !findSpan(state.selected)) state.selected = null;
  draw();
});

// ---------- checkpoints ----------
async function drawCheckpoints() {
  const cps = [...(state.prefs.checkpoints || [])].sort((a, b) => a.t - b.t);
  const handlers = {
    add: async (t, label) => {
      if (cps.some((c) => c.t === t)) return;
      state.prefs = await setDocPrefs(state.ctx.docId, { checkpoints: [...cps, { t, label }].sort((a, b) => a.t - b.t) });
      state.cpResults = [];
      drawCheckpoints();
    },
    remove: async (k) => {
      state.prefs = await setDocPrefs(state.ctx.docId, { checkpoints: cps.filter((_, j) => j !== k) });
      state.cpResults = [];
      drawCheckpoints();
    },
    view: (t) => { state.view.page = 'doc'; slider.set(t); },
  };
  const ready = state.cpResults.length === cps.length;
  renderCheckpoints($('checkpoints'), state.full, cps, ready ? state.cpResults : [], handlers);
  if (!ready) {
    const results = [];
    for (const c of cps) results.push(await analyzeAt(c.t));
    state.cpResults = results;
    if (state.view.page === 'checkpoints') renderCheckpoints($('checkpoints'), state.full, cps, results, handlers);
  }
}

// ---------- drawing ----------
function currentTab() { return state.result.tabs[Math.min(state.tabIndex, state.result.tabs.length - 1)]; }
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
  const page = state.view.page;
  document.body.classList.toggle('student', state.mode === 'student');
  document.body.classList.toggle('page-compare', page === 'compare');
  document.body.classList.toggle('page-checkpoints', page === 'checkpoints');
  for (const [id, p] of [['page-doc', 'doc'], ['page-compare', 'compare'], ['page-checkpoints', 'checkpoints']]) $(id).setAttribute('aria-selected', String(page === p));
  for (const [id, c] of [['by-process', 'process'], ['by-writer', 'writer'], ['by-when', 'when']]) $(id).setAttribute('aria-pressed', String(state.view.colorBy === c));
  $('compare').hidden = page !== 'compare';
  $('checkpoints').hidden = page !== 'checkpoints';
  if (page === 'compare') renderCompare($('compare'), r, state.mode, showWriter);
  if (page === 'checkpoints') drawCheckpoints();
  renderBanners($('banners'), r, {
    startProvided: { label: 'Count it as the student’s instead', run: () => setStartText(false) },
    startStudent: { label: 'Treat it as provided', run: () => setStartText(true) },
    asOf: { label: 'Back to now', run: () => slider.set(null) },
  });
  renderTabs($('tab-picker'), r, state.tabIndex, (k) => { state.tabIndex = k; state.selected = null; draw(); });
  renderDoc($('doc'), currentTab(), r, state.mode, state.view, select);
  renderSections($('sections'), $('doc'), currentTab().sections || [], currentTab().sectionsFrom, playSection);
  if (state.jumpSection) {
    const key = state.jumpSection;
    state.jumpSection = null;
    const sec = (currentTab().sections || []).find((x) => x.key === key);
    const target = sec && $('doc').querySelector(`[data-para="${sec.para}"]`);
    if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 50);
  }
  $('edit-count').textContent = '';
  finder.refresh();
  renderFocus();
  renderSummary($('summary'), $('share-bar'), r, state.mode);
  renderContrib($('contrib'), r, state.mode, state.view, setRole, (owner) => { state.view.focus = owner; draw(); });
  renderLegend($('legend'), r, state.mode, state.view);
  drawSelection();
  $('testing-card').hidden = !state.settings.showTesting || state.mode === 'student';
  if (state.settings.showTesting) {
    renderTesting($('testing'), state.full, state.fetchInfo, (name) => downloadRaw(state.raw, state.fetchInfo, name, VERSION));
  }
}

// From a student's card: back to the document, showing only their text in their color.
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

// ---------- replay ----------
async function playEdits(req, title) {
  const btn = document.activeElement;
  if (btn && btn.tagName === 'BUTTON') btn.disabled = true;
  try {
    const w = await work('replay', req);
    if (!w.windows.length) return status('There are no edits to play here.');
    replay.large = state.result && state.result.largeInsertion;
    replay.open(w.windows, title);
  } catch (err) {
    fail(err.code || 'ANALYSIS_FAILED', err.message);
  } finally {
    if (btn && btn.tagName === 'BUTTON') btn.disabled = false;
  }
}

// Everything under a heading, up to the next heading at its level.
function playSection(sec) {
  const tab = currentTab();
  const spans = tab.spans.filter((sp) => sp.para >= sec.para && sp.para < sec.endPara);
  const runs = spans.flatMap((sp) => sp.runs || []);
  const part = spans.flatMap((sp) => sp.part || []);
  playEdits({ tab: tab.id, runs, part }, `How “${sec.label}” was written`);
}

function drawSelection() {
  const found = state.selected ? findSpan(state.selected) : null;
  markSelected($('doc'), state.selected);
  renderTimeline($('timeline'), state.full || state.result, found ? found.sp.events : []);
  renderInspector($('inspector'), state.result, found && found.sp, found && found.tab, state.mode, {
    pinned: found && state.pins.has(found.sp.id),
    replay: () => playEdits({ tab: found.tab.id, runs: found.sp.runs, part: found.sp.part }, 'How this passage was written'),
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
for (const [id, p] of [['page-doc', 'doc'], ['page-compare', 'compare'], ['page-checkpoints', 'checkpoints']]) $(id).addEventListener('click', () => { state.view.page = p; draw(); });
for (const [id, c] of [['by-process', 'process'], ['by-writer', 'writer'], ['by-when', 'when']]) $(id).addEventListener('click', () => { state.view.colorBy = c; draw(); });
$('btn-refresh').addEventListener('click', () => load({ refresh: true }));
$('play-all').addEventListener('click', () => playEdits({ tab: currentTab().id, whole: true }, 'The whole document being written'));
$('note').addEventListener('input', (e) => {
  state.note = e.target.value;
  if (state.ctx) saveNote(state.ctx.docId, state.note);
});
$('due-at').addEventListener('change', async (e) => {
  const v = e.target.value;
  state.prefs = await setDocPrefs(state.ctx.docId, { dueAt: v ? new Date(v).getTime() : null });
  await reanalyze();
});
$('due-clear').addEventListener('click', async () => {
  $('due-at').value = '';
  state.prefs = await setDocPrefs(state.ctx.docId, { dueAt: null });
  await reanalyze();
});

function printWarning() {
  return confirm('A printed or saved report is part of the student’s education record. Store and share it the way your school handles student work.\n\nContinue to print?');
}
$('btn-print').addEventListener('click', () => {
  if (!printWarning()) return;
  const pins = [...state.pins].map(findSpan).filter(Boolean);
  renderPrintExtra($('print-pins'), $('print-note'), $('print-method'), state.result, pins, state.mode === 'student' ? '' : state.note, state.mode);
  const students = state.result.contributions.editors.filter((e) => e.role === 'student').length;
  $('print-compare-wrap').hidden = students < 2;
  renderCompare($('print-compare'), state.result, state.mode, () => {});
  window.print();
});
// One page per student, from the Compare students tab.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#print-students-btn')) return;
  if (!printWarning()) return;
  const pins = [...state.pins].map(findSpan).filter(Boolean);
  renderStudentPages($('print-students'), state.result, state.mode, pins, state.mode === 'student' ? '' : state.note);
  document.body.classList.add('printing-students');
  window.print();
  document.body.classList.remove('printing-students');
});

// ---------- settings ----------
const dlg = $('settings');
for (const [k, name] of DAY_NAMES.entries()) {
  $('set-days').appendChild(h('label', { class: 'day' }, h('input', { type: 'checkbox', value: String(k) }), name));
}
$('btn-settings').addEventListener('click', () => {
  $('set-ttl').value = String(state.settings.ttlMin);
  $('set-button').checked = state.settings.showButton !== false;
  $('set-testing').checked = !!state.settings.showTesting;
  $('set-school-on').checked = state.settings.schoolOn === true;
  $('set-headings').checked = state.settings.headingsOnly !== false;
  $('set-cb').checked = !!state.settings.colorBlind;
  const sch = state.settings.schedule;
  for (const box of $('set-days').querySelectorAll('input')) box.checked = sch.days.includes(Number(box.value));
  $('set-start').value = sch.start;
  $('set-end').value = sch.end;
  $('set-cleared').textContent = '';
  dlg.showModal();
});
$('set-close').addEventListener('click', async () => {
  const before = JSON.stringify([state.settings.schoolOn, state.settings.schedule, state.settings.headingsOnly !== false]);
  state.settings.ttlMin = Number($('set-ttl').value) || DEFAULT_SETTINGS.ttlMin;
  state.settings.showButton = $('set-button').checked;
  state.settings.showTesting = $('set-testing').checked;
  state.settings.schoolOn = $('set-school-on').checked;
  state.settings.headingsOnly = $('set-headings').checked;
  state.settings.colorBlind = $('set-cb').checked;
  applyPalette(state.settings);
  state.settings.schedule = {
    days: [...$('set-days').querySelectorAll('input:checked')].map((b) => Number(b.value)),
    start: $('set-start').value || DEFAULT_SETTINGS.schedule.start,
    end: $('set-end').value || DEFAULT_SETTINGS.schedule.end,
  };
  await saveSettings();
  dlg.close();
  if (state.full && before !== JSON.stringify([state.settings.schoolOn, state.settings.schedule, state.settings.headingsOnly !== false])) await reanalyze();
  else draw();
});
$('set-clear').addEventListener('click', async () => {
  const items = await chrome.storage.session.get(null);
  // Keep only the job keys that let open viewer tabs reconnect.
  await chrome.storage.session.remove(Object.keys(items).filter((k) => !k.startsWith('job:')));
  const local = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(local).filter((k) => /^(doc|dash):/.test(k)));
  state.settings.roles = {};
  await saveSettings();
  state.note = '';
  $('note').value = '';
  $('set-cleared').textContent = 'Cleared cached analyses, notes, editor roles, due dates, checkpoints and dashboards.';
});

$('set-setup').addEventListener('click', () => { dlg.close(); openSetup(); });
$('btn-dashboard').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('viewer/dashboard.html') }));

(async () => {
  await loadSettings();
  await sweep();
  await load();
})();
