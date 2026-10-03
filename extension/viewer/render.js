// Draws the analysis: the coloured document, summary, legend, timeline and
// passage inspector. Everything is built with dom.js, never from HTML strings.

import { h, s, clear, append, fmtTime, fmtClock } from './dom.js';
import { CATEGORY_TEXT, BADGE_TEXT, ALTERNATIVES, BANNERS, ROLE_TEXT, ROLE_HELP, eventText } from '../lib/wording.js';
import { CAT_ORDER, STUDENT_CATS } from '../lib/classify.js';
import { summaryRows, pct, duration, METHOD_NOTES } from '../lib/report.js';

export const ICON = { linear: '→', light: '✎', heavy: '↻', large: '⇣', pasted: '⧉', unclear: '?', mixed: '≈', provided: '▭', teacher: 'T' };
const COLOR_VAR = { linear: '--c-linear', light: '--c-light', heavy: '--c-heavy', large: '--c-large', pasted: '--c-pasted', unclear: '--c-unclear', mixed: '--c-mixed', provided: '--c-unclear', teacher: '--c-unclear' };

function swatch(cat) {
  return h('span', { class: `swatch cat-${cat}`, 'aria-hidden': 'true', text: ICON[cat] });
}

export function renderBanners(el, result) {
  clear(el);
  for (const key of result.banners) {
    const b = BANNERS[key];
    const text = typeof b === 'function' ? b(result.summary.editors) : b;
    if (text) el.appendChild(h('div', { class: `banner ${key}`, text }));
  }
}

export function renderTabs(el, result, active, onPick) {
  clear(el);
  el.hidden = result.tabs.length < 2;
  result.tabs.forEach((t, k) => {
    el.appendChild(h('button', { type: 'button', 'aria-pressed': String(k === active), onclick: () => onPick(k), text: `Tab ${k + 1}` }));
  });
}

// Writer colours for "Who wrote it": one per student, never reused for
// provided or teacher text (those stay grey).
export const WRITER_RGB = ['0, 114, 178', '213, 94, 0', '0, 158, 115', '204, 121, 167', '86, 180, 233', '230, 159, 0', '117, 112, 179', '102, 166, 30'];

export function writerColor(result, owner) {
  if (!owner || !owner.startsWith('student:')) return null;
  const students = result.contributions.editors.filter((e) => e.role === 'student');
  const k = students.findIndex((e) => e.owner === owner);
  return WRITER_RGB[(k < 0 ? 0 : k) % WRITER_RGB.length];
}

const TS_STYLE = (ts) => {
  const css = [];
  if (ts.b) css.push('font-weight:700');
  if (ts.i) css.push('font-style:italic');
  const deco = [ts.u && 'underline', ts.x && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration-line:${deco}`);
  // Google sizes are points at 11 pt body text; keep them relative and sane.
  if (typeof ts.fs === 'number' && ts.fs > 0) css.push(`font-size:${Math.min(3, Math.max(0.6, ts.fs / 11)).toFixed(2)}em`);
  if (ts.va === 1 || ts.va === 'sup') css.push('vertical-align:super;font-size:0.75em');
  if (ts.va === 2 || ts.va === 'sub') css.push('vertical-align:sub;font-size:0.75em');
  return css.join(';');
};

// Text of [a, b) cut at formatting changes.
function styledText(tab, a, b, runIdx) {
  const out = [];
  let at = a;
  const runs = tab.runs;
  while (at < b) {
    while (runIdx.k < runs.length && runs[runIdx.k].end <= at) runIdx.k++;
    const run = runs[runIdx.k];
    if (run && run.start <= at) {
      const end = Math.min(b, run.end);
      out.push(h('span', { style: TS_STYLE(run.ts) }, tab.text.slice(at, end)));
      at = end;
    } else {
      const end = Math.min(b, run ? run.start : b);
      out.push(document.createTextNode(tab.text.slice(at, end)));
      at = end;
    }
  }
  return out;
}

const ALIGN = { 1: 'center', 2: 'right', 3: 'justify' };

function paragraphEl(p, listCounters) {
  const ps = p.ps || {};
  const lvl = Number(ps.h);
  let el;
  if (lvl >= 1 && lvl <= 6) el = h(`h${Math.min(lvl, 6) === 1 ? 2 : Math.min(lvl + 1, 6)}`, { class: `dh dh${lvl}` });
  else if (lvl === 100) el = h('h2', { class: 'dh dtitle' });
  else if (lvl === 101) el = h('p', { class: 'dsubtitle' });
  else el = h('p');
  if (ps.list) {
    el.classList.add('dli');
    el.style.marginLeft = `${1.5 + 1.5 * (ps.n || 0)}em`;
    el.dataset.bullet = ['•', '◦', '▪'][(ps.n || 0) % 3];
  } else if (typeof ps.il === 'number' && ps.il > 0) {
    el.style.marginLeft = `${Math.min(10, ps.il / 36).toFixed(2)}em`;
  }
  if (ALIGN[ps.al]) el.style.textAlign = ALIGN[ps.al];
  return el;
}

// view: { colorBy: 'process' | 'writer', focus: owner or '' }
export function renderDoc(el, tab, result, mode, view, onSelect) {
  clear(el);
  const T = CATEGORY_TEXT[mode];
  const byPara = new Map();
  for (const sp of tab.spans) {
    if (!byPara.has(sp.para)) byPara.set(sp.para, []);
    byPara.get(sp.para).push(sp);
  }
  const runIdx = { k: 0 };
  const spanEl = (sp) => {
    const isStudent = sp.owner && sp.owner.startsWith('student:');
    let cls = `ps cat-${sp.cat}`;
    let style = null;
    if (view.colorBy === 'writer' && isStudent) {
      cls = 'ps own';
      style = `--own:${writerColor(result, sp.owner)}`;
    }
    if (view.focus && sp.owner !== view.focus) cls += ' dim';
    return h('span', {
      class: cls, style, tabindex: '0', role: 'button', dataset: { id: sp.id },
      title: `${T[sp.cat].label}${isStudent ? ` · ${writerLabel(result, sp.owner)}` : ''} · first written ${fmtTime(sp.m.firstT)}`,
      'aria-label': `${T[sp.cat].label}: ${tab.text.slice(sp.start, Math.min(sp.end, sp.start + 60))}`,
    }, styledText(tab, sp.start, sp.end, runIdx));
  };
  const fillPara = (p, idx) => {
    const para = paragraphEl(p);
    let at = p.start;
    for (const sp of byPara.get(idx) || []) {
      if (sp.start > at) para.append(...styledText(tab, at, sp.start, runIdx));
      para.appendChild(spanEl(sp));
      at = sp.end;
    }
    if (p.end > at) para.append(...styledText(tab, at, p.end, runIdx));
    return para;
  };

  // Rebuild tables from Google's markers; everything else is a paragraph.
  const root = document.createDocumentFragment();
  const stack = []; // open tables: { table, row, cell }
  const target = () => {
    const t = stack[stack.length - 1];
    if (!t) return root;
    if (!t.row) { t.row = h('tr'); t.table.appendChild(t.row); }
    if (!t.cell) { t.cell = h('td'); t.row.appendChild(t.cell); }
    return t.cell;
  };
  for (const item of tab.layout || tab.paragraphs.map((_, p) => ({ p }))) {
    if (item.p !== undefined) {
      const p = tab.paragraphs[item.p];
      const inCell = stack.length > 0;
      if (inCell && p.end === p.start) continue; // the empty line that closes a cell
      target().appendChild(fillPara(p, item.p));
      continue;
    }
    switch (item.m) {
      case '\u0010': {
        const table = h('table', { class: 'dtable' });
        target().appendChild(table);
        stack.push({ table, row: null, cell: null });
        break;
      }
      case '\u0012': if (stack.length) { const t = stack[stack.length - 1]; t.row = h('tr'); t.cell = null; t.table.appendChild(t.row); } break;
      case '\u001c': if (stack.length) { const t = stack[stack.length - 1]; if (!t.row) { t.row = h('tr'); t.table.appendChild(t.row); } t.cell = h('td'); t.row.appendChild(t.cell); } break;
      case '\u0011': stack.pop(); break;
      default: break;
    }
  }
  el.appendChild(root);
  el.onclick = (e) => {
    const t = e.target.closest('.ps');
    if (t) onSelect(t.dataset.id);
  };
  el.onkeydown = (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('ps')) {
      e.preventDefault();
      onSelect(e.target.dataset.id);
    }
  };
}

export function writerLabel(result, owner) {
  if (owner === 'provided') return CATEGORY_TEXT.teacher.provided.label;
  if (owner === 'teacher') return CATEGORY_TEXT.teacher.teacher.label;
  const id = owner.slice('student:'.length);
  const a = result.actors.find((x) => x.id === id);
  if (!a) return 'Unknown editor';
  return a.name ? `${a.label} (${a.name})` : a.label;
}

export function markSelected(docEl, id) {
  for (const n of docEl.querySelectorAll('.ps.sel')) n.classList.remove('sel');
  if (id) {
    const n = docEl.querySelector(`.ps[data-id="${CSS.escape(id)}"]`);
    if (n) n.classList.add('sel');
  }
}

export function renderSummary(dl, bar, result, mode) {
  clear(dl);
  for (const [k, v] of summaryRows(result.summary, mode)) append(dl, [h('dt', { text: k }), h('dd', { text: v })]);
  clear(bar);
  for (const c of CAT_ORDER) {
    const share = result.summary.shares[c];
    if (share > 0) {
      bar.appendChild(h('span', { title: `${CATEGORY_TEXT[mode][c].label} ${pct(share)}`, style: `width:${(share * 100).toFixed(2)}%;background:rgb(var(${COLOR_VAR[c]}))` }));
    }
  }
}

export function renderLegend(ul, result, mode, view) {
  clear(ul);
  const T = CATEGORY_TEXT[mode];
  const present = new Set(result.tabs.flatMap((t) => t.spans.map((sp) => sp.cat)));
  if (view && view.colorBy === 'writer') {
    for (const e of result.contributions.editors.filter((x) => x.role === 'student')) {
      ul.appendChild(h('li', {}, h('span', { class: 'swatch own', style: `--own:${writerColor(result, e.owner)}`, 'aria-hidden': 'true' }),
        h('span', {}, h('span', { class: 'label', text: writerLabel(result, e.owner) }), h('span', { class: 'desc', text: `${pct(e.share)} of the final text` }))));
    }
  } else {
    for (const c of STUDENT_CATS) {
      if (c === 'pasted' && !result.caps.pasteMarker) continue;
      ul.appendChild(h('li', {}, swatch(c), h('span', {}, h('span', { class: 'label', text: T[c].label }), h('span', { class: 'desc', text: T[c].short }))));
    }
  }
  for (const c of ['provided', 'teacher']) {
    if (present.has(c)) ul.appendChild(h('li', {}, swatch(c), h('span', {}, h('span', { class: 'label', text: T[c].label }), h('span', { class: 'desc', text: T[c].short }))));
  }
}

// "Who wrote what": the provided text, the teacher's text, and each editor.
// onRole(id, role) re-runs the analysis; onFocus(owner) highlights one writer.
export function renderContrib(el, result, mode, view, onRole, onFocus) {
  clear(el);
  const c = result.contributions;
  const table = h('table', { class: 'contrib' });
  table.appendChild(h('tr', {}, h('th', { text: 'Writer' }), h('th', { text: 'Final text' }), h('th', { text: 'Words' }), h('th', { text: 'Active' })));
  const bar = (cats) => h('div', { class: 'mini-bar', 'aria-hidden': 'true' },
    STUDENT_CATS.filter((k) => cats[k] > 0).map((k) => h('span', { style: `width:${(cats[k] * 100).toFixed(1)}%;background:rgb(var(${COLOR_VAR[k]}))` })));
  const focusBtn = (owner, label) => h('button', {
    type: 'button', class: `link${view.focus === owner ? ' on' : ''}`, 'aria-pressed': String(view.focus === owner),
    title: 'Highlight only this writer’s text', onclick: () => onFocus(view.focus === owner ? '' : owner), text: label,
  });
  if (c.provided.finalChars) {
    table.appendChild(h('tr', { class: 'bucket' }, h('td', {}, swatch('provided'), focusBtn('provided', CATEGORY_TEXT[mode].provided.label)),
      h('td', { text: pct(c.provided.share) }), h('td', { text: String(c.provided.words) }), h('td', { text: '' })));
  }
  if (c.teacher.finalChars) {
    table.appendChild(h('tr', { class: 'bucket' }, h('td', {}, swatch('teacher'), focusBtn('teacher', CATEGORY_TEXT[mode].teacher.label)),
      h('td', { text: pct(c.teacher.share) }), h('td', { text: String(c.teacher.words) }), h('td', { text: '' })));
  }
  for (const e of c.editors) {
    const a = result.actors.find((x) => x.id === e.id) || {};
    const name = `${a.label || 'Editor'}${a.name ? ` (${a.name})` : ''}${a.isSelf ? ' · you' : ''}`;
    const role = h('select', { class: 'role teacher-only', 'aria-label': `Role of ${name}`, onchange: (ev) => onRole(e.id, ev.target.value) },
      ['student', 'teacher', 'provided'].map((r) => h('option', { value: r, selected: e.role === r, text: ROLE_TEXT[r] })));
    const isStudent = e.role === 'student';
    const who = h('td', {},
      isStudent ? h('span', { class: 'swatch own', style: `--own:${writerColor(result, e.owner)}`, 'aria-hidden': 'true' }) : swatch(e.role === 'teacher' ? 'teacher' : 'provided'),
      isStudent ? focusBtn(e.owner, name) : h('span', { text: name }),
      h('div', { class: 'sub' }, role, h('span', { class: 'role-text', text: ROLE_TEXT[e.role] })),
      isStudent ? bar(e.cats) : null,
      h('div', { class: 'sub hint', text: `typed or inserted ${e.inserted.toLocaleString()}, deleted ${e.deleted.toLocaleString()}${e.removedProvided ? `, removed ${e.removedProvided.toLocaleString()} of the provided text` : ''}` }));
    table.appendChild(h('tr', {}, who,
      h('td', { text: isStudent ? pct(e.share) : '—' }), h('td', { text: isStudent ? String(e.words) : '—' }), h('td', { text: duration(e.activeMs) })));
  }
  el.appendChild(table);
  el.appendChild(h('p', { class: 'hint teacher-only', text: ROLE_HELP }));
}

// Sessions side by side, idle gaps collapsed. Marks the selected passage's edits.
export function renderTimeline(el, result, highlight = []) {
  clear(el);
  const sessions = result.timeline.sessions;
  if (!sessions.length) { el.appendChild(h('p', { class: 'hint', text: 'No timed edits.' })); return; }
  const W = 340, H = 90, MID = 46, GAP = 10;
  const minutes = sessions.reduce((a, x) => a + x.ins.length, 0);
  const unit = Math.max(0.5, (W - GAP * (sessions.length - 1)) / Math.max(minutes, 1));
  const peak = Math.max(1, ...sessions.flatMap((x) => [...x.ins, ...x.del]));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Editing activity over ${sessions.length} session(s)` });
  const highlightTimes = highlight.map((i) => result.events[i] && result.events[i].t).filter((t) => t != null);
  let x = 0;
  sessions.forEach((ses, k) => {
    const w = ses.ins.length * unit;
    svg.appendChild(s('line', { class: 'axis', x1: x, x2: x + w, y1: MID, y2: MID }));
    ses.ins.forEach((v, b) => {
      if (v) { const hgt = Math.max(1, (v / peak) * 36); svg.appendChild(s('rect', { class: 'ins', x: x + b * unit, y: MID - hgt, width: Math.max(unit - 0.3, 0.6), height: hgt })); }
      const d = ses.del[b];
      if (d) { const hgt = Math.max(1, (d / peak) * 30); svg.appendChild(s('rect', { class: 'del', x: x + b * unit, y: MID + 1, width: Math.max(unit - 0.3, 0.6), height: hgt })); }
    });
    const pos = (t) => x + Math.min(w, ((t - ses.start) / 60000) * unit);
    for (const L of result.timeline.large) {
      if (L.t >= ses.start && L.t <= ses.end) svg.appendChild(s('path', { class: 'large', d: `M${pos(L.t) - 4},4 L${pos(L.t) + 4},4 L${pos(L.t)},11 Z` }, s('title', {}, `${L.n} characters inserted at once, ${fmtClock(L.t)}`)));
    }
    for (const t of highlightTimes) {
      if (t >= ses.start && t <= ses.end) svg.appendChild(s('line', { class: 'mark', x1: pos(t), x2: pos(t), y1: 12, y2: 80 }));
    }
    if (w > 40 || k === 0) svg.appendChild(s('text', { x, y: H - 2 }, new Date(ses.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })));
    x += w + GAP;
  });
  el.appendChild(svg);
}

function actorName(result, a) {
  const actor = result.actors[a];
  if (!actor) return 'Someone';
  return actor.name ? `${actor.label} (${actor.name})` : actor.label;
}

export function passageFacts(sp) {
  const m = sp.m;
  return [
    ['Characters', String(m.n)],
    ['First written', fmtTime(m.firstT)],
    ['Last changed', fmtTime(m.lastT)],
    ['In large insertions (80+ characters)', pct(m.largeShare)],
    ['Revision load', m.revisionLoad.toFixed(2)],
    ['Changed after moving on', pct(m.postShare)],
    ['Written in place', pct(m.linearity)],
    ['Moved or copied within the document', pct(m.movedShare)],
    ['History unclear', pct(m.unclearShare)],
  ];
}

export function renderInspector(el, result, sp, tab, mode, handlers) {
  clear(el);
  if (!sp) { el.appendChild(h('p', { class: 'hint', text: 'Click any passage in the document to see exactly how it was written.' })); return; }
  const T = CATEGORY_TEXT[mode][sp.cat];
  el.appendChild(h('h3', {}, swatch(sp.cat), T.label));
  if (sp.owner) el.appendChild(h('p', { class: 'hint', text: `Written by: ${writerLabel(result, sp.owner)}` }));
  el.appendChild(h('div', { class: 'quote', text: tab.text.slice(sp.start, sp.end) }));
  el.appendChild(h('p', { text: T.long }));
  if (sp.badges.length) el.appendChild(h('div', { class: 'badges' }, sp.badges.map((b) => h('span', { class: 'badge', text: BADGE_TEXT[b] }))));
  const alts = ALTERNATIVES[sp.cat];
  if (alts && alts.length) el.appendChild(h('p', { class: 'alts', text: `The same record can come from: ${alts.join('; ')}.` }));
  const table = h('table', {});
  for (const [k, v] of passageFacts(sp)) table.appendChild(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
  el.appendChild(table);

  const list = h('ul', { class: 'events', 'aria-label': 'Edits behind this passage' });
  for (const i of sp.events) {
    const ev = result.events[i];
    if (!ev || ev.op === 'fmt' || ev.op === 'other') continue;
    list.appendChild(h('li', {}, h('time', { text: ev.t == null ? 'start' : fmtTime(ev.t) }), h('span', { text: eventText(ev, actorName(result, ev.a)) })));
  }
  if (sp.eventsTotal > sp.events.length) list.appendChild(h('li', {}, h('span', {}), h('span', { class: 'hint', text: `…and ${sp.eventsTotal - sp.events.length} more edits (shown in the replay)` })));
  el.appendChild(h('h3', { text: 'Edits' }));
  el.appendChild(list);

  el.appendChild(h('div', { class: 'buttons' },
    h('button', { type: 'button', onclick: handlers.replay, text: 'Replay this passage' }),
    h('button', { type: 'button', class: 'teacher-only', onclick: handlers.pin, text: handlers.pinned ? 'Remove from printed report' : 'Add to printed report' })));
}

export function renderPrintExtra(pinsEl, noteEl, methodEl, result, pins, note, mode) {
  clear(pinsEl);
  const T = CATEGORY_TEXT[mode];
  if (!pins.length) pinsEl.appendChild(h('p', { text: 'None selected.' }));
  for (const { sp, tab } of pins) {
    const t = h('table', {});
    for (const [k, v] of passageFacts(sp)) t.appendChild(h('tr', {}, h('td', { text: k }), h('td', { text: v })));
    pinsEl.appendChild(h('div', { class: 'pin' },
      h('strong', { text: `${ICON[sp.cat]} ${T[sp.cat].label}` }),
      h('p', { class: 'quote', text: tab.text.slice(sp.start, sp.end) }),
      h('p', { text: T[sp.cat].long }),
      ALTERNATIVES[sp.cat] && ALTERNATIVES[sp.cat].length ? h('p', { text: `The same record can come from: ${ALTERNATIVES[sp.cat].join('; ')}.` }) : null,
      t));
  }
  noteEl.textContent = note || 'None.';
  clear(methodEl);
  for (const n of METHOD_NOTES) methodEl.appendChild(h('li', { text: n }));
  methodEl.appendChild(h('li', { text: `Printed ${new Date().toLocaleString()}. Active time ${duration(result.summary.activeMs)} is an estimate.` }));
}
