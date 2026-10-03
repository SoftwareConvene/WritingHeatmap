// Draws the analysis: the coloured document, summary, legend, timeline and
// passage inspector. Everything is built with dom.js, never from HTML strings.

import { h, s, clear, append, fmtTime, fmtClock } from './dom.js';
import { CATEGORY_TEXT, BADGE_TEXT, ALTERNATIVES, BANNERS, eventText } from '../lib/wording.js';
import { CAT_ORDER } from '../lib/classify.js';
import { summaryRows, pct, duration, METHOD_NOTES } from '../lib/report.js';

export const ICON = { linear: '→', light: '✎', heavy: '↻', large: '⇣', pasted: '⧉', unclear: '?', mixed: '≈' };
const COLOR_VAR = { linear: '--c-linear', light: '--c-light', heavy: '--c-heavy', large: '--c-large', pasted: '--c-pasted', unclear: '--c-unclear', mixed: '--c-mixed' };

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

// The finished text, paragraph by paragraph, with each passage as a focusable span.
export function renderDoc(el, tab, mode, onSelect) {
  clear(el);
  const T = CATEGORY_TEXT[mode];
  const byPara = new Map();
  for (const sp of tab.spans) {
    if (!byPara.has(sp.para)) byPara.set(sp.para, []);
    byPara.get(sp.para).push(sp);
  }
  const frag = document.createDocumentFragment();
  tab.paragraphs.forEach((p, idx) => {
    const para = h('p');
    let at = p.start;
    for (const sp of byPara.get(idx) || []) {
      if (sp.start > at) para.appendChild(document.createTextNode(tab.text.slice(at, sp.start)));
      const span = h('span', {
        class: `ps cat-${sp.cat}`, tabindex: '0', role: 'button', dataset: { id: sp.id },
        title: `${T[sp.cat].label} · first written ${fmtTime(sp.m.firstT)}`,
        'aria-label': `${T[sp.cat].label}: ${tab.text.slice(sp.start, Math.min(sp.end, sp.start + 60))}`,
      }, tab.text.slice(sp.start, sp.end));
      para.appendChild(span);
      at = sp.end;
    }
    if (p.end > at) para.appendChild(document.createTextNode(tab.text.slice(at, p.end)));
    frag.appendChild(para);
  });
  el.appendChild(frag);
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

export function renderLegend(ul, result, mode) {
  clear(ul);
  const T = CATEGORY_TEXT[mode];
  for (const c of CAT_ORDER) {
    if (c === 'pasted' && !result.caps.pasteMarker) continue;
    ul.appendChild(h('li', {}, swatch(c), h('span', {}, h('span', { class: 'label', text: T[c].label }), h('span', { class: 'desc', text: T[c].short }))));
  }
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
