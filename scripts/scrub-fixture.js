// Turns a "Save raw history for testing" download into a committed fixture:
//   node scripts/scrub-fixture.js <download.json> fixtures/<name>
// Replaces account, session and document ids, drops profile data, and refuses
// to write anything check-fixtures would reject.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { checkFixtureText } from './check-fixtures.js';
import { analyze } from '../extension/lib/analyze.js';

const DROP = new Set(['token', 'ouid', 'userMap', 'userInfo', 'photo', 'revisionMac', 'name', 'email', 'color', 'sid']);
const X = ")]}'\n";

export function scrub(raw) {
  const users = new Map(), sessions = new Map();
  const alias = (map, prefix, v) => {
    if (v == null || v === '') return v;
    if (!map.has(v)) map.set(v, `${prefix}-${map.size + 1}`);
    return map.get(v);
  };
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  const page = (body) => {
    if (body == null) return null;
    const json = JSON.parse(String(body).replace(/^\)\]\}'\n?/, ''));
    if (Array.isArray(json.changelog)) {
      json.changelog = json.changelog.map((e) => {
        if (!Array.isArray(e)) return e;
        const out = [...e];
        out[2] = alias(users, 'user', out[2]);
        out[4] = alias(sessions, 'sess', out[4]);
        return strip(out);
      });
    }
    return X + JSON.stringify(strip(json));
  };
  let tiles = null;
  if (raw.tiles) {
    const j = JSON.parse(String(raw.tiles).replace(/^\)\]\}'\n?/, ''));
    tiles = X + JSON.stringify({ tileInfo: (j.tileInfo || []).map((t) => ({ start: t.start, end: t.end })), firstRev: j.firstRev ?? null });
  }
  return {
    schema: 'wh-fixture-1',
    fixtureName: raw.fixtureName || '',
    capturedAt: (raw.capturedAt || '').slice(0, 10),
    variant: raw.variant,
    lastRev: raw.lastRev,
    tiles,
    pages: (raw.pages || []).map(page),
    exportText: raw.exportText ?? null,
    snapshot: page(raw.snapshot),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) { console.log('usage: node scripts/scrub-fixture.js <download.json> fixtures/<name>'); process.exit(2); }
  const fixture = scrub(JSON.parse(readFileSync(src, 'utf8')));
  const text = JSON.stringify(fixture, null, 1);
  const problems = checkFixtureText(text);
  if (problems.length) { console.log(`Not written: still contains ${problems.join(', ')}. Fix by hand or extend the scrubber.`); process.exit(1); }
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'raw.json'), text);
  if (fixture.exportText != null) writeFileSync(join(dest, 'final.txt'), fixture.exportText);
  // A starter expectation from today's analysis, to be corrected by hand
  // against what was actually done in the test document.
  const r = analyze({ pages: fixture.pages, exportText: fixture.exportText, snapshotBody: fixture.snapshot, tilesBody: fixture.tiles });
  const markers = {};
  for (const t of r.tabs) for (const s of t.spans) {
    const m = /\b([A-Z]{4,})\b/.exec(t.text.slice(s.start, s.end));
    if (m && !markers[m[1]]) markers[m[1]] = s.cat;
  }
  writeFileSync(join(dest, 'expect.json'), JSON.stringify({ name: basename(dest), completeness: r.summary.completeness, markers, notes: 'Starter values from the analysis. Correct them to what was really done.' }, null, 2) + '\n');
  console.log(`Wrote ${dest}: ${fixture.pages.length} page(s), completeness ${r.summary.completeness}, markers ${JSON.stringify(markers)}`);
}
