// Settings that belong to one document: its due date, checkpoints, and the
// starting-text choice. Kept in this browser only, and forgotten after a
// school year so old documents do not pile up.

import { DEFAULT_SCHEDULE } from '../lib/when.js';

const DOC_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export const DEFAULT_SETTINGS = {
  ttlMin: 60, showButton: true, showTesting: false, variant: null, roles: {},
  headingsOnly: true, schoolOn: true, schedule: { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] },
};

export async function getDocPrefs(docId) {
  const key = `doc:${docId}`;
  const got = (await chrome.storage.local.get(key))[key];
  return got && got.expires > Date.now() ? got : { startAsProvided: true, dueAt: null, checkpoints: [] };
}

export async function setDocPrefs(docId, patch) {
  const cur = await getDocPrefs(docId);
  const next = { ...cur, ...patch, expires: Date.now() + DOC_TTL_MS };
  await chrome.storage.local.set({ [`doc:${docId}`]: next });
  return next;
}

export async function sweepDocPrefs() {
  const all = await chrome.storage.local.get(null);
  const dead = Object.keys(all).filter((k) => /^(doc|dash):/.test(k) && !(all[k] && all[k].expires > Date.now()));
  if (dead.length) await chrome.storage.local.remove(dead);
}

export function scheduleOf(settings) {
  return settings.schoolOn === false ? null : (settings.schedule || DEFAULT_SCHEDULE);
}

// <input type="datetime-local"> values, in local time.
export function toLocalInput(t) {
  if (!t) return '';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
