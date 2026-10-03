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
  function addButton() {
    if (document.getElementById('writing-heatmap-launch')) return;
    const b = document.createElement('button');
    b.id = 'writing-heatmap-launch';
    b.type = 'button';
    b.textContent = 'Writing Heatmap';
    b.title = 'Analyze how this document was written';
    Object.assign(b.style, {
      position: 'fixed', left: '16px', bottom: '16px', zIndex: '2147483000', padding: '10px 18px',
      font: '600 15px/1.2 system-ui, sans-serif', color: '#fff', background: '#16a34a', border: '0',
      borderRadius: '999px', boxShadow: '0 2px 6px rgba(0,0,0,.3)', cursor: 'pointer', opacity: '0.95',
    });
    b.addEventListener('click', () => chrome.runtime.sendMessage({ wh: 'open-viewer' }));
    document.body.appendChild(b);
  }

  chrome.storage.local.get('settings').then(({ settings }) => {
    if (!settings || settings.showButton !== false) addButton();
  }).catch(() => addButton());
})();
