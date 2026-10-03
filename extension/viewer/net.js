// Loading a document's history without its tab open, for the class dashboard.
// The extension page asks docs.google.com directly with the teacher's own
// sign-in (host permission for docs.google.com/document only). If Google
// refuses that, the document is opened in a background tab, read through the
// content script exactly as when the teacher clicks the button, and closed.

import { findInfoParams } from '../lib/gdocs/endpoints.js';
import { ask } from './fetcher.js';

const DOCS = 'https://docs.google.com/document/';

function allowed(url) {
  try { return new URL(url).href.startsWith(DOCS); } catch { return false; }
}

// Same shape as the content script's answer: { ok, status, body }.
export async function directGet(url, headers) {
  if (!allowed(url)) return { ok: false, status: 0, code: 'REFUSED' };
  try {
    const res = await fetch(url, { credentials: 'include', headers: headers || {} });
    const body = await res.text();
    // A sign-in or "request access" page means no access, whatever the status.
    const signIn = !res.url.startsWith(DOCS);
    return { ok: res.ok && !signIn, status: signIn ? 403 : res.status, body };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
}

export function docUrl(docId, u = 0) {
  return `${DOCS}u/${u}/d/${encodeURIComponent(docId)}/edit`;
}

// The same context the content script would report, read from the edit page.
export async function directContext(docId, u = 0) {
  const res = await directGet(docUrl(docId, u));
  if (!res.ok) return { ok: false, code: res.status === 403 || res.status === 401 ? 'NO_ACCESS' : 'FETCH_FAILED' };
  const p = findInfoParams(res.body);
  const title = (/<title>([^<]*)<\/title>/i.exec(res.body) || [])[1] || '';
  const clean = title.replace(/\s*-\s*Google Docs\s*$/, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return { ok: true, docId, u, token: p.token || '', ouid: p.ouid || '', title: clean };
}

// Fallback: a background tab, read through the content script, then closed.
export async function withBackgroundTab(docId, u, fn) {
  const tab = await chrome.tabs.create({ url: docUrl(docId, u), active: false });
  try {
    let ctx = null;
    for (let k = 0; k < 60 && !(ctx && ctx.ok); k++) {
      await new Promise((r) => setTimeout(r, 500));
      ctx = await ask(tab.id, { wh: 'context' }).catch(() => null);
    }
    if (!ctx || !ctx.ok) return { ok: false, code: 'NO_ACCESS' };
    return await fn(tab.id, ctx);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}
