// Loads a document's history through the content script on its tab. Tries
// the URL variants in order, remembers the one that worked, finds the last
// revision, then pages through the history.

import { VARIANTS, variantById, loadUrl, tilesUrl, exportTxtUrl, headersFor } from '../lib/gdocs/endpoints.js';
import { parseBody } from '../lib/gdocs/parse.js';

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

export class DocFetcher {
  constructor(tabId, ctx, preferred) {
    this.tabId = tabId;
    this.ctx = ctx;
    this.preferred = preferred;
    this.variant = null;
    this.probes = [];
  }

  get(url, headers) {
    return ask(this.tabId, { wh: 'get', url, headers });
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
      this.probes.push({ id: v.id, label: v.label, status: res.status || res.code, ok: good });
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
