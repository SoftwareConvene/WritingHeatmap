// Loads a document's history through the content script on its tab. Tries
// the URL variants in order, remembers the one that worked, finds the last
// revision, then pages through the history.

import { VARIANTS, variantById, loadUrl, tilesUrl, exportTxtUrl, headersFor, KIND } from '../lib/gdocs/endpoints.js';
import { parseBody, describeBody } from '../lib/gdocs/parse.js';

const SAMPLE_CHARS = 50_000; // per probe reply kept for a Slides test save

export const PAGE_SIZE = 1000;

export class FetchError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

export function ask(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError || !res) reject(new FetchError('TAB_CLOSED'));
      else resolve(res);
    });
  });
}

function looksLikeHistory(body) {
  try { return Array.isArray(parseBody(body).changelog); } catch { return false; }
}

// transport(url, headers) -> { ok, status, body }: through a document tab's
// content script, or direct from an extension page (net.js).
export function tabTransport(tabId) {
  return (url, headers) => ask(tabId, { wh: 'get', url, headers });
}

export class DocFetcher {
  constructor(transport, ctx, preferred) {
    this.transport = typeof transport === 'function' ? transport : tabTransport(transport);
    this.ctx = ctx;
    this.preferred = preferred;
    this.variant = null;
    this.probes = [];
  }

  get(url, headers) {
    return this.transport(url, headers);
  }

  async probe() {
    const order = [...VARIANTS];
    const pref = variantById(this.preferred);
    if (pref) order.sort((a, b) => (a.id === pref.id ? -1 : b.id === pref.id ? 1 : 0));
    let denied = 0, oddFormat = 0;
    for (const v of order) {
      if (v.token && !this.ctx.token) { this.probes.push({ id: v.id, label: v.label, status: 'no token on page' }); continue; }
      const res = await this.get(loadUrl(this.ctx, v, 1, 1), headersFor(v));
      const good = res.ok && looksLikeHistory(res.body);
      const row = { id: v.id, label: v.label, status: res.status || res.code, ok: good };
      if (this.ctx.kind === KIND.SLIDES) {
        // Slides' format is not known yet: keep what came back so a test save shows it.
        row.shape = describeBody(res.body);
        if (typeof res.body === 'string') row.sample = res.body.slice(0, SAMPLE_CHARS);
      }
      this.probes.push(row);
      if (good) { this.variant = v; return v; }
      if (res.status === 401 || res.status === 403) denied++;
      if (res.ok && !good) oddFormat++;
    }
    if (denied && !oddFormat) throw new FetchError('NO_ACCESS');
    if (oddFormat) throw new FetchError('FORMAT_CHANGED');
    throw new FetchError('FETCH_FAILED');
  }

  async revisionExists(n) {
    const res = await this.get(loadUrl(this.ctx, this.variant, n, n), headersFor(this.variant));
    if (!res.ok) return false;
    try { return parseBody(res.body).changelog.length > 0; } catch { return false; }
  }

  // Last revision from the tiles list, cross-checked by probing; the probe
  // alone is used when tiles are unavailable.
  async lastRevision() {
    let tilesBody = null, fromTiles = null, firstRev = null;
    if (this.ctx.token) {
      const res = await this.get(tilesUrl(this.ctx));
      if (res.ok) {
        try {
          const j = parseBody(res.body);
          const tiles = Array.isArray(j.tileInfo) ? j.tileInfo : [];
          if (tiles.length) fromTiles = Number(tiles[tiles.length - 1].end);
          firstRev = j.firstRev ?? null;
          tilesBody = res.body;
        } catch { /* tiles are optional */ }
      }
    }
    let probed = null;
    if (fromTiles && await this.revisionExists(fromTiles) && !(await this.revisionExists(fromTiles + 1))) {
      probed = fromTiles;
    } else {
      let lo = 0, hi = 1;
      while (await this.revisionExists(hi)) { lo = hi; hi *= 2; if (hi > 4_000_000) break; }
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (await this.revisionExists(mid)) lo = mid; else hi = mid;
      }
      probed = lo;
    }
    return { last: probed, fromTiles, firstRev, tilesBody };
  }

  async pages(last, onProgress) {
    const out = [];
    for (let s = 1; s <= last; s += PAGE_SIZE) {
      const e = Math.min(last, s + PAGE_SIZE - 1);
      const res = await this.get(loadUrl(this.ctx, this.variant, s, e), headersFor(this.variant));
      if (!res.ok) throw new FetchError(res.status === 403 ? 'NO_ACCESS' : 'FETCH_FAILED', `page ${s}-${e}: ${res.status || res.code}`);
      out.push(res.body);
      onProgress && onProgress(e, last);
    }
    return out;
  }

  async exportText() {
    const res = await this.get(exportTxtUrl(this.ctx));
    return res.ok && typeof res.body === 'string' ? res.body : null;
  }

  async snapshotAt(last) {
    const res = await this.get(loadUrl(this.ctx, this.variant, last, last), headersFor(this.variant));
    return res.ok ? res.body : null;
  }
}

// Probe, find the last revision, page through the history, and fetch Google's
// copy of the text. onStatus(text, progress) reports along the way.
// cached: { lastRev, raw } from this session, reused when nothing changed.
export async function loadHistory(fetcher, onStatus = () => {}, cached = null) {
  onStatus('Checking access to the history…', 0.02);
  const variant = await fetcher.probe();
  onStatus('Finding the latest revision…', 0.05);
  const last = await fetcher.lastRevision();
  if (!last.last) throw new FetchError('NO_HISTORY');
  const info = { variant: variant.id, probes: fetcher.probes, last: last.last, fromTiles: last.fromTiles, firstRev: last.firstRev };
  if (cached && cached.lastRev === last.last) return { raw: cached.raw, info: { ...info, cached: true } };
  const pages = await fetcher.pages(last.last, (done, total) => onStatus(`Loading history: revision ${done.toLocaleString()} of ${total.toLocaleString()}…`, 0.05 + 0.85 * (done / total)));
  onStatus('Checking against the current text…', 0.92);
  const exportText = await fetcher.exportText();
  const snapshotBody = exportText == null ? await fetcher.snapshotAt(last.last) : null;
  return { raw: { pages, tilesBody: last.tilesBody, exportText, snapshotBody }, info: { ...info, cached: false } };
}
