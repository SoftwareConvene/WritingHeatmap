// Turns raw revisions/load response bodies into a flat, ordered list of
// commands. Nothing here interprets text; it only unwraps Google's envelope
// and counts what it saw so the feasibility panel can show it.

const XSSI = /^\)\]\}'\n?/;

export function stripXssi(body) {
  return String(body ?? '').replace(XSSI, '');
}

export function parseBody(body) {
  const text = stripXssi(body).trim();
  if (!text) throw codeError('EMPTY_BODY');
  try { return JSON.parse(text); } catch { throw codeError('NOT_JSON'); }
}

function codeError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// A changelog entry is [command, timeMs, userId, revision, sessionId, ...].
// Positions past 5 are kept as `extra` so an unknown marker (a paste flag,
// say) is visible in diagnostics instead of silently dropped.
export function readEntry(raw, idx) {
  if (!Array.isArray(raw) || !raw[0] || typeof raw[0] !== 'object') return null;
  return {
    cmd: raw[0],
    t: typeof raw[1] === 'number' ? raw[1] : null,
    actor: raw[2] == null ? '' : String(raw[2]),
    rev: typeof raw[3] === 'number' ? raw[3] : null,
    session: raw[4] == null ? '' : String(raw[4]),
    extra: raw.length > 5 ? raw.slice(5) : [],
    idx,
  };
}

// Pages may overlap or arrive out of order; revision numbers make them one list.
export function parsePages(bodies) {
  const seen = new Set();
  const entries = [];
  let snapshot = null;
  let badEntries = 0;
  bodies.forEach((body, pageNo) => {
    const json = parseBody(body);
    if (pageNo === 0 && Array.isArray(json.chunkedSnapshot)) snapshot = json.chunkedSnapshot;
    const log = Array.isArray(json.changelog) ? json.changelog : [];
    for (const raw of log) {
      const e = readEntry(raw, entries.length);
      if (!e) { badEntries++; continue; }
      if (e.rev != null) {
        if (seen.has(e.rev)) continue;
        seen.add(e.rev);
      }
      entries.push(e);
    }
  });
  if (entries.every((e) => e.rev != null)) entries.sort((a, b) => a.rev - b.rev);
  entries.forEach((e, i) => { e.idx = i; });
  return { entries, snapshot, badEntries };
}

// Depth-first walk that unwraps multi-commands (mlti) and tab wrappers (nm),
// calling visit(leafCommand, tabId).
export function flatten(cmd, tab, visit) {
  if (!cmd || typeof cmd !== 'object') return;
  if (cmd.ty === 'mlti' && Array.isArray(cmd.mts)) {
    for (const c of cmd.mts) flatten(c, tab, visit);
    return;
  }
  if (cmd.ty === 'nm' && cmd.nmc) {
    flatten(cmd.nmc, tabFromNmr(cmd.nmr) ?? tab, visit);
    return;
  }
  visit(cmd, tab);
}

function tabFromNmr(nmr) {
  if (!Array.isArray(nmr)) return null;
  const t = nmr.find((x) => typeof x === 'string' && /^t\./.test(x));
  return t ?? null;
}

// The chunked snapshot is a list of chunks, each a list of commands that build
// the document as it stood when this page of history begins.
export function snapshotCommands(snapshot) {
  const out = [];
  if (!Array.isArray(snapshot)) return out;
  for (const chunk of snapshot) {
    if (Array.isArray(chunk)) out.push(...chunk.filter((c) => c && typeof c === 'object'));
    else if (chunk && typeof chunk === 'object') out.push(chunk);
  }
  return out;
}

// Counts per command type, the keys each type carried, and how long entries
// were. This is the evidence for "is there a paste marker?".
export function diagnostics(entries) {
  const counts = {};
  const keys = {};
  const entryLengths = {};
  const extraSamples = [];
  for (const e of entries) {
    flatten(e.cmd, '', (c) => {
      const ty = String(c.ty ?? '?');
      counts[ty] = (counts[ty] || 0) + 1;
      const k = (keys[ty] ||= new Set());
      for (const key of Object.keys(c)) k.add(key);
    });
    const n = 5 + e.extra.length;
    entryLengths[n] = (entryLengths[n] || 0) + 1;
    if (e.extra.some((x) => x !== null) && extraSamples.length < 20) {
      extraSamples.push(e.extra.map((x) => (typeof x === 'string' ? `<string ${x.length}>` : x)));
    }
  }
  const keyLists = Object.fromEntries(Object.entries(keys).map(([t, s]) => [t, [...s].sort()]));
  return { counts, keys: keyLists, entryLengths, extraSamples };
}

// What a response looked like, without its content: for probing a format we
// have not seen yet (Google Slides). -> { json, keys, changelog, first }
export function describeBody(body) {
  let json;
  try { json = parseBody(body); } catch (e) { return { json: false, error: e.code || 'NOT_JSON', chars: String(body ?? '').length }; }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { json: true, keys: [], type: Array.isArray(json) ? 'array' : typeof json };
  const log = Array.isArray(json.changelog) ? json.changelog : null;
  const first = log && log.length && Array.isArray(log[0]) ? log[0].map((x) => (x && typeof x === 'object' ? (Array.isArray(x) ? 'array' : `{${Object.keys(x).join(',')}}`) : typeof x)) : null;
  return { json: true, keys: Object.keys(json).sort(), changelog: log ? log.length : null, first };
}
