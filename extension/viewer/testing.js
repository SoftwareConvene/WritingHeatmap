// Testing tools: the Phase 0 feasibility check and the raw history download.
// Shown only when turned on in Settings. Built for the maintainer's own test
// documents, never for student work.

import { h, clear } from './dom.js';

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
  if (d.extraSamples.length) el.appendChild(h('pre', {}, h('code', { text: `Extra entry fields (samples):\n${d.extraSamples.map((x) => JSON.stringify(x)).join('\n')}` })));

  el.appendChild(h('h3', { text: 'Save raw history' }));
  el.appendChild(h('p', { class: 'hint', text: 'Downloads this document’s raw history as a JSON file so it can be scrubbed and added to the test set. Use this only on your own test documents, never on student work.' }));
  const name = h('input', { type: 'text', placeholder: 'fixture name, e.g. external-paste', 'aria-label': 'Fixture name' });
  el.appendChild(h('div', { class: 'row' }, name, h('button', { type: 'button', onclick: () => onSave(name.value.trim()), text: 'Save raw history for testing' })));
}

// The download never includes the document id or title.
export function downloadRaw(raw, fetchInfo, fixtureName, version) {
  const payload = {
    schema: 'wh-raw-1',
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
