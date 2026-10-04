// The class dashboard's pure parts: reading pasted links, the row of numbers
// for each document, and lining up the same section across every copy.

import { parseDocUrl } from './gdocs/endpoints.js';
import { STUDENT_CATS } from './classify.js';

// "Student 1, https://docs.google.com/document/d/…/edit" or just the link,
// one per line. Tabs and " - " also separate a name from its link.
export function parseLinks(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /(https?:\/\/docs\.google\.com\/document\/\S+)/.exec(line);
    if (!m) continue;
    const doc = parseDocUrl(m[1]);
    if (!doc || seen.has(doc.docId)) continue;
    seen.add(doc.docId);
    const label = line.slice(0, m.index).replace(/[\s,;:\t–—-]+$/, '').trim();
    out.push({ docId: doc.docId, u: doc.u, label });
  }
  return out;
}

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

// One row of the dashboard table, from one document's analysis.
export function rowMetrics(r) {
  const students = r.contributions.editors.filter((e) => e.role === 'student');
  const add = (f) => students.reduce((a, e) => a + (e[f] || 0), 0);
  const sh = r.summary.shares;
  const when = r.summary.when;
  return {
    words: r.summary.studentWords,
    studentShare: r.summary.studentShare,
    students: students.length,
    typed: add('typed'),
    chunked: add('chunked'),
    chunks: add('chunks'),
    copied: add('copied'),
    retyped: add('retypedWords'),
    deleted: add('deleted'),
    composed: sh.linear || 0,
    revised: (sh.light || 0) + (sh.heavy || 0),
    large: (sh.large || 0) + (sh.pasted || 0),
    school: when.shares.school,
    home: when.shares.home,
    late: when.shares.late,
    activeMs: r.summary.activeMs,
    sessions: r.summary.sessions,
    firstT: r.summary.firstT,
    lastT: r.summary.lastT,
    shares: Object.fromEntries(STUDENT_CATS.map((c) => [c, sh[c] || 0])),
    completeness: r.summary.completeness,
  };
}

// Sections that appear across documents, in their usual order.
// results: [{ id, result }]. -> [{ key, label, count, order }]
export function commonSections(results) {
  const by = new Map();
  for (const { result } of results) {
    const secs = result.tabs.flatMap((t) => t.sections || []);
    const seenHere = new Set();
    secs.forEach((s, k) => {
      if (seenHere.has(s.key)) return;
      seenHere.add(s.key);
      const e = by.get(s.key) || { key: s.key, label: s.label, count: 0, pos: 0 };
      e.count++;
      e.pos += secs.length > 1 ? k / (secs.length - 1) : 0;
      by.set(s.key, e);
    });
  }
  return [...by.values()]
    .map((e) => ({ key: e.key, label: e.label, count: e.count, order: e.pos / e.count }))
    .sort((a, b) => a.order - b.order || b.count - a.count);
}

// The sections most of the class's documents share: a copy made from the
// wrong template, or a link to the wrong file, does not fill the list with
// sections nobody else has. With 3 or more documents a section must be in at
// least half of them; the rest are counted so the page can offer them.
export function majoritySections(results, showAll = false) {
  const all = commonSections(results);
  const n = results.length;
  const need = n >= 3 ? Math.ceil(n / 2) : 1;
  const shown = showAll ? all : all.filter((s) => s.count >= need);
  return { shown, hidden: all.length - shown.length, need };
}

// The part of a tab that one section covers, shaped like a tab so the same
// renderer draws it. Paragraph indices are kept, so spans still line up.
export function sliceSection(tab, key) {
  const sec = (tab.sections || []).find((s) => s.key === key);
  if (!sec) return null;
  const inRange = (p) => p >= sec.para && p < sec.endPara;
  const layout = [];
  let started = false;
  for (const item of tab.layout || []) {
    if (item.p !== undefined) {
      if (inRange(item.p)) { started = true; layout.push(item); } else if (started && item.p >= sec.endPara) break;
    } else if (started) layout.push(item);
  }
  const words = sum(Object.fromEntries(Object.entries(sec.words).filter(([o]) => o.startsWith('student:'))));
  return { ...tab, layout, spans: tab.spans.filter((sp) => inRange(sp.para)), sections: [sec], section: sec, studentWords: words };
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

// Names for a dashboard's rows, in place of "Student 1, Student 2": each
// Doc's student editors, as Google names them, writers of the most words
// first. Anyone who edits most of the class's Docs is a teacher or
// co-teacher, not the student the Doc belongs to, and is left out, as is
// anyone marked Teacher or Provided. A Doc nobody named has written in
// falls back to its title when Google Classroom made the copy, which puts
// the student's name first ("Name - Assignment").
// docs: [{ docId, title, result }]. -> Map(docId -> name)
export function studentNames(docs) {
  const done = docs.filter((d) => d.result);
  const seen = new Map();
  for (const d of done) for (const a of d.result.actors || []) seen.set(a.id, (seen.get(a.id) || 0) + 1);
  const many = (id) => done.length >= 3 && seen.get(id) >= Math.max(3, done.length / 2);
  const fromTitle = titleNames(docs);
  const out = new Map();
  for (const d of docs) {
    let name = '';
    if (d.result) {
      const named = new Map((d.result.actors || []).filter((a) => a.name).map((a) => [a.id, a.name.trim()]));
      const people = d.result.contributions.editors
        .filter((e) => e.role === 'student' && named.get(e.id) && !many(e.id) && (e.words || e.inserted))
        .sort((a, b) => (b.words || 0) - (a.words || 0) || b.inserted - a.inserted)
        .map((e) => named.get(e.id));
      const unique = [...new Set(people)];
      name = unique.length <= 2 ? unique.join(' & ') : `${unique.slice(0, 2).join(', ')} +${unique.length - 2}`;
    }
    out.set(d.docId, name || fromTitle.get(d.docId) || '');
  }
  return out;
}

// Classroom titles its copies "Student Name - Assignment title". The part
// before the first " - " is taken as a name only where several Docs share
// the part after it and differ before it. -> Map(docId -> name)
function titleNames(docs) {
  const split = (t) => {
    const k = (t || '').indexOf(' - ');
    return k > 0 ? [t.slice(0, k).trim(), t.slice(k + 3).trim()] : null;
  };
  const bySuffix = new Map();
  for (const d of docs) {
    const p = split(d.title);
    if (!p || !p[1] || p[0].length > 60 || !/^[\p{L}][\p{L}' .-]*$/u.test(p[0])) continue;
    const list = bySuffix.get(p[1]) || [];
    list.push([d.docId, p[0]]);
    bySuffix.set(p[1], list);
  }
  const out = new Map();
  for (const list of bySuffix.values()) {
    if (list.length < 2 || new Set(list.map(([, n]) => n)).size < 2) continue;
    for (const [id, n] of list) out.set(id, n);
  }
  return out;
}
