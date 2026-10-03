// Testing tools: the Phase 0 feasibility check and the raw history download.
// Shown only when turned on in Settings. Built for the maintainer's own test
// documents, never for student work.

import { h, clear } from './dom.js';
import { parsePages, diagnostics } from '../lib/gdocs/parse.js';

function row(k, v, cls) {
  return h('tr', {}, h('th', { text: k }), h('td', { class: cls || '', text: v == null ? '—' : String(v) }));
}

function verdict(ok) {
  return ok == null ? ['not checked', ''] : ok ? ['yes', 'go'] : ['no', 'stop'];
}

export function renderTesting(el, result, fetchInfo, onSave) {
  clear(el);
  const d = result.diagnostics;
  const checks = [
    ['1. History loads with your sign-in, no extra permission', fetchInfo.variant != null],
    ['2. Tiles and probing agree on the last revision', fetchInfo.fromTiles == null ? null : fetchInfo.fromTiles === fetchInfo.last],
    ['3. Rebuilt text matches Google’s copy', d.compare.status === 'unverified' ? null : d.compare.status === 'exact'],
    ['5. Timestamps are milliseconds', d.timesInMs],
    ['5. Typed batches are small (median under 20 characters)', d.typedBatchMedian == null ? null : d.typedBatchMedian < 20],
    ['8. Analysis finished in under 30 seconds', (fetchInfo.fetchMs + (d.analysisMs || 0)) < 30000],
  ];
  const t = h('table', { class: 'testing' });
  for (const [k, ok] of checks) { const [v, cls] = verdict(ok); t.appendChild(row(k, v, cls)); }
  el.appendChild(t);
  el.appendChild(h('p', { class: 'hint', text: 'Items 4, 6, 7 and 9 need a person: compare the command counts below with what you did in the test document, and watch DevTools → Network (requests should go to docs.google.com only).' }));

  el.appendChild(h('h3', { text: 'Fetching' }));
  const f = h('table', { class: 'testing' });
  for (const p of fetchInfo.probes) f.appendChild(row(`Variant ${p.id} (${p.label})`, `${p.status}${p.ok ? ' ✓' : ''}`));
  f.appendChild(row('Last revision (probed)', fetchInfo.last));
  f.appendChild(row('Last revision (tiles)', fetchInfo.fromTiles));
  f.appendChild(row('First revision (tiles)', fetchInfo.firstRev));
  f.appendChild(row('Revisions parsed', d.revisions));
  f.appendChild(row('Bad entries skipped', d.badEntries));
  f.appendChild(row('Fetch time', `${fetchInfo.fetchMs} ms${fetchInfo.cached ? ' (from session cache)' : ''}`));
  f.appendChild(row('Analysis time', `${d.analysisMs} ms`));
  el.appendChild(f);

  el.appendChild(h('h3', { text: 'Rebuild' }));
  const r = h('table', { class: 'testing' });
  r.appendChild(row('Checked against', d.compare.reference));
  r.appendChild(row('Match', d.compare.ratio == null ? d.compare.status : `${d.compare.status} (${Math.round(d.compare.ratio * 1000) / 10}%)`));
  r.appendChild(row('Snapshot matched state', d.compare.matchedState));
  r.appendChild(row('4. Delete ranges include their end', d.deleteInclusive));
  for (const tr of d.tries) r.appendChild(row(`  inclusive=${tr.deleteInclusive}`, `match ${tr.ratio == null ? '—' : Math.round(tr.ratio * 1000) / 10 + '%'}, out-of-range ${tr.outOfRange}`));
  r.appendChild(row('Moves / copies / replacements', `${d.lineage.moves} / ${d.lineage.copies} / ${d.lineage.replacements}`));
  r.appendChild(row('Resets (rplc)', d.lineage.resets));
  r.appendChild(row('Unknown commands', d.lineage.unknown));
  r.appendChild(row('Median typed batch / largest', `${d.typedBatchMedian} / ${d.maxBatch}`));
  el.appendChild(r);

  el.appendChild(h('h3', { text: '6–7. Command types and the fields they carry' }));
  const c = h('table', { class: 'testing' });
  for (const [ty, n] of Object.entries(d.counts).sort((a, b) => b[1] - a[1])) {
    c.appendChild(h('tr', {}, h('th', { text: ty }), h('td', { text: String(n) }), h('td', {}, h('code', { text: (d.keys[ty] || []).join(', ') }))));
  }
  el.appendChild(c);
  el.appendChild(h('p', { class: 'hint', text: `Entry lengths: ${JSON.stringify(d.entryLengths)}` }));
  // Headings come from these: Writing Heatmap expects type "paragraph" with
  // ps_hd 1–6 (Heading 1–6) or 100 (Title).
  el.appendChild(h('h3', { text: 'Style codes seen (headings should show as paragraph → ps_hd)' }));
  const sk = d.styleKeys || {};
  if (!Object.keys(sk).length) el.appendChild(h('p', { class: 'hint', text: 'No style commands in this history.' }));
  const st = h('table', { class: 'testing' });
  for (const [type, keys] of Object.entries(sk)) {
    for (const [k, vals] of Object.entries(keys)) st.appendChild(h('tr', {}, h('th', { text: type }), h('td', { text: k }), h('td', {}, h('code', { text: vals.join(', ') }))));
  }
  el.appendChild(st);
  const heads = (result.tabs || []).flatMap((t) => (t.paragraphs || []).filter((p) => p.ps && p.ps.h).map((p) => p.ps.h));
  el.appendChild(h('p', { class: 'hint', text: `Paragraphs read as headings: ${heads.length} (levels ${[...new Set(heads)].sort((a, b) => a - b).join(', ') || '—'}). Sections from: ${(result.tabs || []).map((t) => t.sectionsFrom).join(', ')}.` }));
  if (d.extraSamples.length) el.appendChild(h('pre', {}, h('code', { text: `Extra entry fields (samples):\n${d.extraSamples.map((x) => JSON.stringify(x)).join('\n')}` })));

  el.appendChild(h('h3', { text: 'Save raw history' }));
  el.appendChild(h('p', { class: 'hint', text: 'Downloads this document’s raw history as a JSON file so it can be scrubbed and added to the test set. Use this only on your own test documents, never on student work.' }));
  const name = h('input', { type: 'text', placeholder: 'fixture name, e.g. external-paste', 'aria-label': 'Fixture name' });
  el.appendChild(h('div', { class: 'row' }, name, h('button', { type: 'button', onclick: () => onSave(name.value.trim()), text: 'Save raw history for testing' })));
}

// The download never includes the document id or title.
export function downloadRaw(raw, fetchInfo, fixtureName, version, kind = 'document') {
  const payload = {
    schema: 'wh-raw-1',
    kind,
    extensionVersion: version,
    capturedAt: new Date().toISOString(),
    fixtureName: fixtureName || '',
    variant: fetchInfo.variant,
    probes: fetchInfo.probes,
    lastRev: fetchInfo.last,
    fromTiles: fetchInfo.fromTiles,
    firstRev: fetchInfo.firstRev,
    tiles: raw.tilesBody,
    pages: raw.pages,
    exportText: raw.exportText,
    snapshot: raw.snapshotBody,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `writing-heatmap-raw-${(fixtureName || 'doc').replace(/[^a-z0-9-]+/gi, '-')}-${Date.now()}.json` });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const SLIDES_ERRORS = {
  FORMAT_CHANGED: 'Google answered, but not in the layout Docs uses. That is useful to know: the saved file shows what came back.',
  NO_ACCESS: 'Google refused. You need edit access to this deck.',
  NO_HISTORY: 'Google answered, but with no revisions.',
  FETCH_FAILED: 'None of the requests worked. The saved file lists what each one returned.',
  TAB_CLOSED: 'The deck’s tab was closed or reloaded. Open it again and click the button.',
};

// Google Slides, being tested: what the deck's history looked like, and a
// save button so the format can be worked out from a practice deck.
// probe: { raw, info, error }
export function renderSlidesProbe(el, probe, onSave) {
  clear(el);
  const { raw, info, error } = probe;
  el.appendChild(h('h2', { text: 'Google Slides: testing' }));
  el.appendChild(h('p', { text: 'Writing Heatmap can’t colour Slides yet. Google keeps an edit history for Slides too, but its layout isn’t known yet. This page checks whether the history can be read and lets you save it, so the Slides view can be built from a real example.' }));

  const found = info.variant != null;
  const t = h('table', { class: 'testing' });
  t.appendChild(row('History can be read with your sign-in', found ? 'yes' : 'no', found ? 'go' : 'stop'));
  if (error) t.appendChild(row('What happened', SLIDES_ERRORS[error] || error));
  t.appendChild(row('Revisions', info.last));
  t.appendChild(row('Last revision (tiles)', info.fromTiles));
  t.appendChild(row('History pages loaded', raw.pages.length));
  t.appendChild(row('Google’s plain-text copy', raw.exportText == null ? 'not available' : `${raw.exportText.length.toLocaleString()} characters`));
  el.appendChild(t);

  el.appendChild(h('h3', { text: 'What each request returned' }));
  const f = h('table', { class: 'testing' });
  for (const p of info.probes || []) {
    const sh = p.shape || {};
    const what = !sh.json ? `not JSON${sh.chars != null ? ` (${sh.chars} characters)` : ''}`
      : `keys: ${(sh.keys || []).join(', ') || '—'}${sh.changelog != null ? `; ${sh.changelog} history entries` : ''}${sh.first ? `; entry = [${sh.first.join(', ')}]` : ''}`;
    f.appendChild(h('tr', {}, h('th', { text: `Variant ${p.id} (${p.label})` }), h('td', { class: p.ok ? 'go' : '', text: `${p.status}${p.ok ? ' ✓' : ''}` }), h('td', {}, h('code', { text: what }))));
  }
  el.appendChild(f);

  if (raw.pages.length) {
    try {
      const d = diagnostics(parsePages(raw.pages).entries);
      el.appendChild(h('h3', { text: 'Command types and the fields they carry' }));
      const c = h('table', { class: 'testing' });
      for (const [ty, n] of Object.entries(d.counts).sort((a, b) => b[1] - a[1])) {
        c.appendChild(h('tr', {}, h('th', { text: ty }), h('td', { text: String(n) }), h('td', {}, h('code', { text: (d.keys[ty] || []).join(', ') }))));
      }
      el.appendChild(c);
    } catch { el.appendChild(h('p', { class: 'hint', text: 'The history pages are not in the Docs layout.' })); }
  }

  el.appendChild(h('h3', { text: 'Save raw history' }));
  el.appendChild(h('p', { class: 'hint', text: 'The file holds this deck’s full text and every edit. Use it only on a practice deck you made yourself, never on a student’s work.' }));
  const name = h('input', { type: 'text', id: 'slides-fixture-name', placeholder: 'name, e.g. slides-practice', 'aria-label': 'Name for the saved file' });
  el.appendChild(h('div', { class: 'row' }, name, h('button', { type: 'button', id: 'slides-save', class: 'primary', onclick: () => onSave(name.value.trim() || 'slides'), text: 'Save raw history for testing' })));
}

