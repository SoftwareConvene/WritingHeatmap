// URL builders for Google Docs' internal revision history. These routes are
// undocumented: open-source readers in 2026 disagree about which parameters
// are required, so the fetcher tries VARIANTS in order and remembers the first
// one that works. Add a variant here rather than editing one, so the
// feasibility panel can still say which one a school's account needed.

const ORIGIN = 'https://docs.google.com';

function base(ctx, withUser) {
  const u = withUser ? `/u/${ctx.u ?? 0}` : '';
  return `${ORIGIN}/document${u}/d/${encodeURIComponent(ctx.docId)}`;
}

function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export const VARIANTS = [
  { id: 'A', label: 'cookies only', user: false, token: false, extra: false, sameDomain: false },
  { id: 'B', label: '+ account path, token, tab', user: true, token: true, extra: false, sameDomain: false },
  { id: 'C', label: '+ ouid and info params', user: true, token: true, extra: true, sameDomain: false },
  { id: 'D', label: '+ x-same-domain header', user: true, token: true, extra: true, sameDomain: true },
];

export function variantById(id) {
  return VARIANTS.find((v) => v.id === id) || null;
}

export function loadUrl(ctx, variant, start, end) {
  const p = { id: ctx.docId, start, end };
  if (variant.token) Object.assign(p, { token: ctx.token, tab: ctx.tab || 't.0' });
  if (variant.extra) {
    Object.assign(p, {
      ouid: ctx.ouid, includes_info_params: 'true', smv: '9', smb: '[9, ]', srfn: 'false',
      ern: 'false', showDetailedRevisions: 'true', cros_files: 'false',
    });
  }
  return `${base(ctx, variant.user)}/revisions/load?${qs(p)}`;
}

export function tilesUrl(ctx) {
  return `${base(ctx, true)}/revisions/tiles?${qs({
    id: ctx.docId, start: 1, showDetailedRevisions: 'false', filterNamed: 'false',
    token: ctx.token, includes_info_params: 'true',
  })}`;
}

export function exportTxtUrl(ctx) {
  return `${base(ctx, true)}/export?format=txt`;
}

export function headersFor(variant) {
  return variant.sameDomain ? { 'x-same-domain': '1' } : {};
}

// Reads the doc id and /u/N account index from a Docs URL.
export function parseDocUrl(href) {
  const m = /\/document(?:\/u\/(\d+))?\/d\/([a-zA-Z0-9_-]{20,})/.exec(href || '');
  if (!m) return null;
  return { docId: m[2], u: m[1] ? Number(m[1]) : 0 };
}

// Pulls the per-page token and ouid out of the Docs page's inline script text.
export function findInfoParams(scriptText) {
  const m = /"info_params"\s*:\s*\{([^}]*)\}/.exec(scriptText || '');
  if (!m) return {};
  const token = /"token"\s*:\s*"([^"]+)"/.exec(m[1]);
  const ouid = /"ouid"\s*:\s*"([^"]+)"/.exec(m[1]);
  return { token: token ? token[1] : '', ouid: ouid ? ouid[1] : '' };
}
