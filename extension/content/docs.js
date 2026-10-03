// Runs on Google Docs pages. Two jobs, nothing else:
//  1. tell the viewer which document this is (id, account index, page token);
//  2. fetch history URLs for the viewer, because only a page on
//     docs.google.com carries the teacher's own sign-in for this document.
// It never reads, stores or logs the document's text itself, and it only
// fetches URLs for this same document on docs.google.com.

(() => {
  if (window.__writingHeatmap) return;
  window.__writingHeatmap = true;

  const ORIGIN = 'https://docs.google.com';

  function docFromUrl(href) {
    const m = /\/document(?:\/u\/(\d+))?\/d\/([a-zA-Z0-9_-]{20,})/.exec(href || '');
    return m ? { docId: m[2], u: m[1] ? Number(m[1]) : 0 } : null;
  }

  function infoParams() {
    for (const s of document.scripts) {
      const text = s.textContent;
      if (!text || text.indexOf('info_params') < 0) continue;
      const m = /"info_params"\s*:\s*\{([^}]*)\}/.exec(text);
      if (!m) continue;
      const token = /"token"\s*:\s*"([^"]+)"/.exec(m[1]);
      const ouid = /"ouid"\s*:\s*"([^"]+)"/.exec(m[1]);
      return { token: token ? token[1] : '', ouid: ouid ? ouid[1] : '' };
    }
    return { token: '', ouid: '' };
  }

  // The script holding the token can arrive after the page settles.
  async function context() {
    const doc = docFromUrl(location.href);
    if (!doc) return { ok: false, code: 'NOT_A_DOC' };
    let p = infoParams();
    for (let k = 0; k < 10 && !p.token; k++) {
      await new Promise((r) => setTimeout(r, 300));
      p = infoParams();
    }
    const title = document.title.replace(/\s*-\s*Google Docs\s*$/, '');
    return { ok: true, docId: doc.docId, u: doc.u, token: p.token, ouid: p.ouid, title };
  }

  function allowed(url) {
    const doc = docFromUrl(location.href);
    if (!doc) return false;
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.origin !== ORIGIN) return false;
    const target = docFromUrl(u.pathname);
    return !!target && target.docId === doc.docId;
  }

  async function get(url, headers) {
    if (!allowed(url)) return { ok: false, status: 0, code: 'REFUSED' };
    try {
      const res = await fetch(url, { credentials: 'include', headers: headers || {} });
      const body = await res.text();
      return { ok: res.ok, status: res.status, body, sameOrigin: new URL(res.url).origin === ORIGIN };
    } catch {
      return { ok: false, status: 0, code: 'NETWORK' };
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    // Only this extension's own pages (the viewer) may ask, never a web page.
    if (!msg || sender.id !== chrome.runtime.id || sender.tab) return false;
    if (msg.wh === 'context') { context().then(reply); return true; }
    if (msg.wh === 'get') { get(msg.url, msg.headers).then(reply); return true; }
    return false;
  });

  // A small launcher in the corner of the document, so teachers who have not
  // pinned the icon can still find it. It can be turned off in Settings.
  // Dark button with the logo and a strip of heatmap colours along the bottom;
  // on hover the colours fill the button. It lives in a shadow root so the
  // Doc's own styles cannot reach it.
  const BUTTON_CSS = `
    button { all: initial; position: relative; overflow: hidden; isolation: isolate; box-sizing: border-box;
      display: inline-flex; align-items: center; gap: 9px; padding: 10px 20px 13px 12px; border-radius: 12px;
      background: #1f2937; color: #fff; font: 700 15px/1.2 system-ui, sans-serif; white-space: nowrap;
      box-shadow: 0 2px 6px rgba(0,0,0,.3); cursor: pointer; }
    button::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 5px; z-index: -1;
      transition: height .35s ease;
      background: linear-gradient(90deg, #0072b2 0 34%, #009e73 34% 52%, #e69f00 52% 74%, #cc79a7 74% 90%, #56b4e9 90%); }
    button:hover::after, button:focus-visible::after { height: 100%; }
    button:focus-visible { outline: 3px solid #56b4e9; outline-offset: 2px; }
    span { text-shadow: 0 1px 2px rgba(0,0,0,.45); }
    svg { width: 24px; height: 24px; flex: none; }
    @media (prefers-reduced-motion: reduce) { button::after { transition: none; } }`;

  // The "warm cursor" logo (icons/logo.svg), built node by node.
  function logo() {
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, ...kids) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      n.append(...kids);
      return n;
    };
    const stop = (offset, color) => el('stop', { offset, 'stop-color': color });
    return el('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true' },
      el('defs', {}, el('radialGradient', { id: 'wh-heat', cx: '50%', cy: '58%', r: '70%' },
        stop('0', '#e69f00'), stop('.45', '#cc79a7'), stop('1', '#0072b2'))),
      el('rect', { x: '4', y: '4', width: '56', height: '56', rx: '14', fill: 'url(#wh-heat)', stroke: '#fff', 'stroke-opacity': '.35', 'stroke-width': '2' }),
      el('path', { d: 'M24 15h6a2 2 0 0 1 2 2 2 2 0 0 1 2-2h6M24 49h6a2 2 0 0 0 2-2 2 2 0 0 0 2 2h6M32 17v30',
        fill: 'none', stroke: '#fff', 'stroke-width': '4.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  function addButton() {
    if (document.getElementById('writing-heatmap-launch')) return;
    const host = document.createElement('div');
    host.id = 'writing-heatmap-launch';
    Object.assign(host.style, { position: 'fixed', left: '16px', bottom: '16px', zIndex: '2147483000' });
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = BUTTON_CSS;
    const b = document.createElement('button');
    b.type = 'button';
    b.title = 'Analyze how this document was written';
    const label = document.createElement('span');
    label.textContent = 'Writing Heatmap';
    b.append(logo(), label);
    b.addEventListener('click', () => chrome.runtime.sendMessage({ wh: 'open-viewer' }));
    root.append(style, b);
    document.body.appendChild(host);
  }

  chrome.storage.local.get('settings').then(({ settings }) => {
    if (!settings || settings.showButton !== false) addButton();
  }).catch(() => addButton());
})();
