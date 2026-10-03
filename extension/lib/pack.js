// Class packs: one file that carries a teacher's class dashboards to a
// co-teacher. It holds dashboard names, Doc links with their student labels,
// due dates, checkpoints, review marks, editor roles and school hours. Never
// any document text or analysis: the co-teacher's copy rebuilds those from
// Google with their own sign-in.

import { parseLinks } from './classroom.js';
import { ROLE } from './authors.js';

export const PACK_SCHEMA = 'wh-class-pack-1';
export const PACK_MAX_CHARS = 5_000_000;
const MAX = { dashboards: 200, name: 200, label: 120, docs: 2000, checkpoints: 50, cpLabel: 80, roles: 5000 };
const DOC_ID = /^[a-zA-Z0-9_-]{20,}$/;
const DASH_ID = /^[a-zA-Z0-9-]{1,64}$/;
const ACTOR_ID = /^[\w.:-]{1,80}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ROLES = new Set(Object.values(ROLE));

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const time = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

// Links rebuilt from what parseLinks understood: only Google Doc links, with
// no account number (/u/N differs between teachers).
function cleanLinks(text) {
  return parseLinks(text).map((l) => {
    const url = `https://docs.google.com/document/d/${l.docId}/edit`;
    const label = str(l.label, MAX.label).replace(/[\r\n]+/g, ' ');
    return label ? `${label}, ${url}` : url;
  }).join('\n');
}

function cleanCheckpoints(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX.checkpoints).map((c) => ({ t: time(c && c.t), label: str(c && c.label, MAX.cpLabel) })).filter((c) => c.t);
}

function cleanSchedule(s) {
  if (!s || typeof s !== 'object') return null;
  const days = Array.isArray(s.days) ? [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : null;
  if (!days || !HHMM.test(s.start) || !HHMM.test(s.end)) return null;
  return { days, start: s.start, end: s.end };
}

const docIdsOf = (links) => new Set(parseLinks(links).map((l) => l.docId));

// local: { dashboards: [dash], docs: { docId: prefs }, settings }.
// opts: { ids: dashboard ids to include, roles: bool, school: bool }
export function buildPack(local, opts = {}, now = Date.now()) {
  const ids = opts.ids ? new Set(opts.ids) : null;
  const dashboards = local.dashboards.filter((d) => !ids || ids.has(d.id)).map((d) => {
    const links = cleanLinks(d.links);
    const inLinks = docIdsOf(links);
    const review = Object.fromEntries(Object.entries(d.review || {}).filter(([id, v]) => inLinks.has(id) && v));
    return { id: d.id, name: str(d.name, MAX.name), links, dueAt: time(d.dueAt), checkpoints: cleanCheckpoints(d.checkpoints), review };
  });
  const wanted = new Set(dashboards.flatMap((d) => [...docIdsOf(d.links)]));
  const docs = {};
  for (const [id, p] of Object.entries(local.docs || {})) {
    if (!wanted.has(id) || !p) continue;
    docs[id] = { dueAt: time(p.dueAt), checkpoints: cleanCheckpoints(p.checkpoints), startAsProvided: p.startAsProvided !== false };
  }
  const s = local.settings || {};
  return {
    schema: PACK_SCHEMA,
    made: new Date(now).toISOString(),
    dashboards,
    docs,
    roles: opts.roles === false ? {} : { ...(s.roles || {}) },
    school: opts.school === false ? null : { on: s.schoolOn !== false, schedule: cleanSchedule(s.schedule) },
  };
}

// A pack file from someone else: checked field by field, anything unexpected
// dropped. -> { ok: true, pack } | { ok: false, error }
export function readPack(text) {
  if (typeof text !== 'string' || text.length > PACK_MAX_CHARS) return { ok: false, error: 'TOO_BIG' };
  let j;
  try { j = JSON.parse(text); } catch { return { ok: false, error: 'NOT_A_PACK' }; }
  if (!j || j.schema !== PACK_SCHEMA) return { ok: false, error: 'NOT_A_PACK' };
  const dashboards = (Array.isArray(j.dashboards) ? j.dashboards : []).slice(0, MAX.dashboards).map((d) => {
    if (!d || typeof d !== 'object') return null;
    const links = cleanLinks(str(d.links, PACK_MAX_CHARS));
    const inLinks = docIdsOf(links);
    const review = {};
    for (const [id, v] of Object.entries(d.review && typeof d.review === 'object' ? d.review : {})) if (inLinks.has(id) && [1, 2].includes(v)) review[id] = v;
    return { id: DASH_ID.test(d.id) ? d.id : null, name: str(d.name, MAX.name), links, dueAt: time(d.dueAt), checkpoints: cleanCheckpoints(d.checkpoints), review };
  }).filter((d) => d && d.links);
  const docs = {};
  for (const [id, p] of Object.entries(j.docs && typeof j.docs === 'object' ? j.docs : {}).slice(0, MAX.docs)) {
    if (!DOC_ID.test(id) || !p || typeof p !== 'object') continue;
    docs[id] = { dueAt: time(p.dueAt), checkpoints: cleanCheckpoints(p.checkpoints), startAsProvided: p.startAsProvided !== false };
  }
  const roles = {};
  for (const [id, r] of Object.entries(j.roles && typeof j.roles === 'object' ? j.roles : {}).slice(0, MAX.roles)) if (ACTOR_ID.test(id) && ROLES.has(r)) roles[id] = r;
  const school = j.school && typeof j.school === 'object' && cleanSchedule(j.school.schedule) ? { on: j.school.on !== false, schedule: cleanSchedule(j.school.schedule) } : null;
  if (!dashboards.length) return { ok: false, error: 'EMPTY_PACK' };
  return { ok: true, pack: { made: str(j.made, 40), dashboards, docs, roles, school } };
}

function unionCheckpoints(mine, theirs) {
  const by = new Map(mine.map((c) => [c.t, c]));
  for (const c of theirs) if (!by.has(c.t)) by.set(c.t, c);
  return [...by.values()].sort((a, b) => a.t - b.t).slice(0, MAX.checkpoints);
}

// What importing a pack changes. A dashboard already here (same id) takes the
// pack's name, links and due date; checkpoints are combined; a review mark
// you set yourself is kept. Per-Doc settings and editor roles fill in what is
// missing and never overwrite yours. School hours are taken only if asked.
// -> { dashboards: [dash to save], docs: { docId: prefs }, roles, school, summary }
export function mergePack(local, pack, { school = false, newId = () => crypto.randomUUID() } = {}) {
  const mine = new Map(local.dashboards.map((d) => [d.id, d]));
  let added = 0, updated = 0;
  const dashboards = pack.dashboards.map((p) => {
    const cur = p.id && mine.get(p.id);
    if (!cur) {
      added++;
      return { id: p.id || newId(), name: p.name, links: p.links, dueAt: p.dueAt, checkpoints: p.checkpoints, review: { ...p.review } };
    }
    updated++;
    const review = { ...p.review };
    for (const [id, v] of Object.entries(cur.review || {})) if (v) review[id] = v;
    return { ...cur, name: p.name || cur.name, links: p.links, dueAt: p.dueAt ?? cur.dueAt ?? null, checkpoints: unionCheckpoints(cur.checkpoints || [], p.checkpoints), review };
  });
  const docs = {};
  for (const [id, p] of Object.entries(pack.docs)) {
    const cur = local.docs[id];
    docs[id] = cur
      ? { ...cur, dueAt: cur.dueAt ?? p.dueAt, checkpoints: unionCheckpoints(cur.checkpoints || [], p.checkpoints) }
      : { dueAt: p.dueAt, checkpoints: p.checkpoints, startAsProvided: p.startAsProvided };
  }
  const roles = { ...pack.roles, ...((local.settings && local.settings.roles) || {}) };
  const newRoles = Object.keys(roles).length - Object.keys((local.settings && local.settings.roles) || {}).length;
  return {
    dashboards, docs, roles,
    school: school && pack.school ? pack.school : null,
    summary: { added, updated, docs: Object.keys(docs).length, roles: newRoles },
  };
}
