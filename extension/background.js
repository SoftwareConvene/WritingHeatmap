// Opens the viewer for the document tab the teacher is on. The viewer gets a
// random key, never the document id, so nothing about the document is in a URL.
// On a Google Slides deck it opens the same viewer, which for now only tests
// whether the deck's history can be read. On any other tab the toolbar icon
// opens the class dashboard instead.

import { expiredKeys } from './lib/ttl.js';
import { parseFileUrl } from './lib/gdocs/endpoints.js';

const JOB_TTL_MS = 12 * 60 * 60 * 1000;

async function openViewer(tab) {
  if (!tab || tab.id == null) return;
  const key = crypto.randomUUID();
  await chrome.storage.session.set({ [`job:${key}`]: { tabId: tab.id, expires: Date.now() + JOB_TTL_MS } });
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`viewer/viewer.html#k=${key}`),
    index: typeof tab.index === 'number' ? tab.index + 1 : undefined,
    openerTabId: tab.id,
  });
}

// Chrome only shows this extension a tab's URL on docs.google.com/document
// and /presentation pages, so any other tab (no URL) is neither.
function isDocTab(tab) {
  return !!(tab && tab.url && /^https:\/\/docs\.google\.com\/(document|presentation)\//.test(tab.url) && parseFileUrl(tab.url));
}

async function openDashboard(tab) {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('viewer/dashboard.html'),
    index: tab && typeof tab.index === 'number' ? tab.index + 1 : undefined,
  });
}

async function sweep() {
  const items = await chrome.storage.session.get(null);
  const dead = expiredKeys(items, Date.now());
  if (dead.length) await chrome.storage.session.remove(dead);
}

// On a Google Doc the icon opens the side panel beside it (each student's
// summary); the button inside the Doc still opens the full view. sidePanel.open
// must run straight away in the click, before anything is awaited.
chrome.action.onClicked.addListener((tab) => {
  if (isDocTab(tab) && tab.url.includes('/document/')) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => openViewer(tab));
    return;
  }
  if (isDocTab(tab)) openViewer(tab); else openDashboard(tab);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Only the button this extension draws on a Docs page asks for this.
  if (msg && msg.wh === 'open-viewer' && sender.id === chrome.runtime.id && sender.tab) openViewer(sender.tab);
});

chrome.runtime.onStartup.addListener(sweep);
// School hours start off (a teacher turns them on in the setup guide or
// Settings). Once per browser, existing settings are moved to that default.
// A new install opens the setup guide.
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await sweep();
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  if (!s.schoolDefaultV2) await chrome.storage.local.set({ settings: { ...s, schoolOn: false, schoolDefaultV2: true } });
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('viewer/welcome.html') });
});
