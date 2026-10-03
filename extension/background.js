// Opens the viewer for the document tab the teacher is on. The viewer gets a
// random key, never the document id, so nothing about the document is in a URL.

import { expiredKeys } from './lib/ttl.js';

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

async function sweep() {
  const items = await chrome.storage.session.get(null);
  const dead = expiredKeys(items, Date.now());
  if (dead.length) await chrome.storage.session.remove(dead);
}

chrome.action.onClicked.addListener((tab) => { openViewer(tab); });

chrome.runtime.onMessage.addListener((msg, sender) => {
  // Only the button this extension draws on a Docs page asks for this.
  if (msg && msg.wh === 'open-viewer' && sender.id === chrome.runtime.id && sender.tab) openViewer(sender.tab);
});

chrome.runtime.onStartup.addListener(sweep);
chrome.runtime.onInstalled.addListener(sweep);
