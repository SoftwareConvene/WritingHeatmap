// The "Document as of" slider and the Checkpoints page. Both re-run the
// analysis on a prefix of the history already loaded; nothing is fetched again.

import { h, s, clear, fmtTime } from './dom.js';
import { writerColor, writerLabel } from './render.js';

const SESSION_GAP_MS = 30 * 60 * 1000;

// Moments a teacher can step to: just after each edit, in order.
export function editTimes(result) {
  const out = [];
  for (const e of result.events) {
    if (e.t == null || !['ins', 'del', 'sugins', 'sugdel', 'reset'].includes(e.op)) continue;
    if (!out.length || e.t > out[out.length - 1]) out.push(e.t);
  }
  return out;
}

export class AsOfSlider {
  // onPick(asOf | null): null means "now", the full history.
  constructor(onPick) {
    this.range = document.getElementById('asof-range');
    this.label = document.getElementById('asof-when');
    this.now = document.getElementById('asof-now');
    this.ticks = document.getElementById('asof-ticks');
    this.onPick = onPick;
    this.times = [];
    this.timer = null;
    this.range.addEventListener('input', () => {
      this.showLabel();
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.pick(), 250);
    });
    this.range.addEventListener('change', () => { clearTimeout(this.timer); this.pick(); });
    this.now.addEventListener('click', () => this.set(null));
  }

  // Keeps an "as of" position across a re-analysis without picking again.
  load(full, dueAt, asOf = null) {
    this.times = editTimes(full);
    this.range.max = String(this.times.length);
    this.range.value = String(this.positionOf(asOf));
    this.last = asOf;
    this.dueAt = dueAt;
    this.showLabel();
    this.drawTicks();
  }

  positionOf(asOf) {
    if (asOf == null) return this.times.length;
    let k = 0;
    while (k < this.times.length && this.times[k] <= asOf) k++;
    return k;
  }

  value() {
    const k = Number(this.range.value);
    if (k >= this.times.length) return null;
    return k === 0 ? (this.times[0] ?? 0) - 1 : this.times[k - 1];
  }

  // Jump to a moment (a checkpoint): the last edit at or before it.
  set(asOf) {
    this.range.value = String(this.positionOf(asOf));
    this.showLabel();
    this.pick(asOf);
  }

  showLabel() {
    const v = this.value();
    this.label.textContent = v == null ? 'now (latest)' : Number(this.range.value) === 0 ? 'before the first edit' : fmtTime(v);
    this.now.hidden = v == null;
  }

  pick(exact) {
    const v = exact !== undefined ? exact : this.value();
    if (v === this.last) return;
    this.last = v;
    this.onPick(v);
  }

  // Session starts and the due date, along the slider.
  drawTicks() {
    clear(this.ticks);
    const n = this.times.length;
    if (n < 2) return;
    const W = 1000;
    const svg = s('svg', { viewBox: `0 0 ${W} 14`, preserveAspectRatio: 'none' });
    const x = (k) => (k / n) * W;
    let lastDay = '';
    this.times.forEach((t, k) => {
      if (k > 0 && t - this.times[k - 1] < SESSION_GAP_MS) return;
      svg.appendChild(s('line', { x1: x(k), x2: x(k), y1: 0, y2: 8, class: 'tick' }));
      const day = new Date(t).toDateString();
      if (day !== lastDay) { lastDay = day; svg.appendChild(s('title', {}, fmtTime(t))); }
    });
    if (this.dueAt) {
      let k = 0;
      while (k < n && this.times[k] <= this.dueAt) k++;
      if (k < n) svg.appendChild(s('line', { x1: x(k), x2: x(k), y1: 0, y2: 14, class: 'due' }, s('title', {}, 'Due date')));
    }
    this.ticks.appendChild(svg);
  }
}

// Checkpoints page. checkpoints: [{ t, label }]; results: matching analyzes.
export function renderCheckpoints(el, full, checkpoints, results, handlers) {
  clear(el);
  el.appendChild(h('p', { class: 'hint', text: 'Pick dates (proposal due, data due, final draft…) to see how much each student had written in each section by then. The last column is the document now.' }));

  const add = h('div', { class: 'cp-add teacher-only' },
    h('input', { type: 'datetime-local', id: 'cp-date', 'aria-label': 'Checkpoint date and time' }),
    h('input', { type: 'text', id: 'cp-name', placeholder: 'Name (optional)', 'aria-label': 'Checkpoint name' }),
    h('button', { type: 'button', onclick: () => {
      const v = document.getElementById('cp-date').value;
      if (v) handlers.add(new Date(v).getTime(), document.getElementById('cp-name').value.trim());
    }, text: 'Add checkpoint' }),
    full.summary.when.dueAt ? h('button', { type: 'button', class: 'link', onclick: () => handlers.add(full.summary.when.dueAt, 'Due'), text: 'Add the due date' }) : null);
  el.appendChild(add);

  const cols = [...checkpoints.map((c, k) => ({ ...c, r: results[k] })), { t: null, label: 'Now', r: full }];
  const students = full.contributions.editors.filter((e) => e.role === 'student');
  if (!students.length) { el.appendChild(h('p', { class: 'hint', text: 'No student edits in this document.' })); return; }

  // Section keys in document order, from the current document.
  const keys = [];
  const labels = new Map();
  for (const t of full.tabs) for (const sec of t.sections || []) if (!labels.has(sec.key)) { keys.push(sec.key); labels.set(sec.key, sec.label); }

  const head = h('tr', {}, h('th', { text: 'Section' }), cols.map((c, k) => h('th', {},
    h('div', { text: c.label || `Checkpoint ${k + 1}` }),
    h('div', { class: 'hint', text: c.t == null ? 'latest' : fmtTime(c.t) }),
    c.t == null ? null : h('div', { class: 'cp-actions' },
      h('button', { type: 'button', class: 'link', onclick: () => handlers.view(c.t), text: 'View' }),
      h('button', { type: 'button', class: 'link teacher-only', onclick: () => handlers.remove(k), text: 'Remove' })))));
  const table = h('table', { class: 'grid cp' }, head);

  const wordsIn = (r, key, owner) => {
    if (!r) return null;
    let n = 0;
    for (const t of r.tabs) for (const sec of t.sections || []) if (sec.key === key) n += sec.words[owner] || 0;
    return n;
  };
  const cell = (r, owners, key) => {
    if (!r) return h('td', { class: 'zero', text: '…' });
    const parts = owners.map((o) => [o, key == null ? studentWords(r, o) : wordsIn(r, key, o)]);
    const total = parts.reduce((a, [, n]) => a + n, 0);
    return h('td', { class: total ? '' : 'zero' },
      h('div', { text: total ? `${total} words` : '—' }),
      owners.length > 1 && total ? h('div', { class: 'cp-split' }, parts.filter(([, n]) => n).map(([o, n]) =>
        h('span', { title: `${writerLabel(full, o)}: ${n} words`, style: `flex:${n};background:rgb(${writerColor(full, o)})` }))) : null);
  };
  const owners = students.map((e) => e.owner);
  table.appendChild(h('tr', { class: 'cp-total' }, h('th', { scope: 'row', text: 'Whole document (students)' }), cols.map((c) => cell(c.r, owners, null))));
  for (const key of keys) table.appendChild(h('tr', {}, h('th', { scope: 'row', text: labels.get(key) }), cols.map((c) => cell(c.r, owners, key))));
  el.appendChild(h('div', { class: 'grid-wrap' }, table));

  if (students.length > 1) {
    const per = h('table', { class: 'grid cp' }, h('tr', {}, h('th', { text: 'Student' }), cols.map((c, k) => h('th', { text: c.label || `Checkpoint ${k + 1}` }))));
    for (const e of students) {
      per.appendChild(h('tr', {}, h('th', { scope: 'row' }, h('span', { class: 'swatch own', style: `--own:${writerColor(full, e.owner)}`, 'aria-hidden': 'true' }), writerLabel(full, e.owner)),
        cols.map((c) => h('td', { text: c.r ? `${studentWords(c.r, e.owner)} words` : '…' }))));
    }
    el.appendChild(h('h3', { text: 'Each student’s words in the whole document' }));
    el.appendChild(h('div', { class: 'grid-wrap' }, per));
  }
  if (!keys.length) el.appendChild(h('p', { class: 'hint', text: 'No headings or template lines were found, so only whole-document totals are shown. Style the section titles as Heading 1–6 in the template (Format → Paragraph styles) before copying it to students.' }));
}

function studentWords(r, owner) {
  const e = r.contributions.editors.find((x) => x.owner === owner);
  return e && e.words ? e.words : 0;
}

