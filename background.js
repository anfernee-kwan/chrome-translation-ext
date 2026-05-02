import { translate } from './lib/providers.js';

// Per-tab state: 'untranslated' | 'translating' | 'shown' | 'hidden'
const tabState = new Map();
const STATE = { U: 'untranslated', ING: 'translating', S: 'shown', H: 'hidden' };

async function getConfig() {
  const cfg = await chrome.storage.local.get(['provider', 'baseURL', 'apiKey', 'model']);
  return cfg;
}

function isConfigured(cfg) {
  return cfg && cfg.provider && cfg.baseURL && cfg.apiKey && cfg.model;
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title,
      message,
    });
  } catch (e) {
    console.warn('[bilingual] notify failed', e);
  }
}

async function setBadge(tabId, text, color) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (color) await chrome.action.setBadgeBackgroundColor({ tabId, color });
  } catch {}
}

async function pingContent(tabId) {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    return !!(r && r.ok);
  } catch {
    return false;
  }
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)
    || /^https?:\/\/chrome\.google\.com\/webstore/i.test(url);
}

async function ensureContentScript(tabId, url) {
  if (await pingContent(tabId)) return true;
  if (isRestrictedUrl(url)) return false;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    console.warn('[bilingual] inject failed', e);
    return false;
  }
  return await pingContent(tabId);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  if (!(await ensureContentScript(tabId, tab.url))) {
    await notify('Bilingual Translator', 'This page does not support translation (chrome://, web store, PDF viewer, or restricted page).');
    return;
  }

  const cfg = await getConfig();
  const state = tabState.get(tabId) || STATE.U;

  if (state === STATE.ING) return; // ignore clicks during translation

  if (state === STATE.S || state === STATE.H) {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'toggle' });
    tabState.set(tabId, res && res.hidden ? STATE.H : STATE.S);
    return;
  }

  // untranslated → translate
  if (!isConfigured(cfg)) {
    await notify('Bilingual Translator', 'Configure provider/baseURL/apiKey/model in the options page first.');
    return;
  }

  tabState.set(tabId, STATE.ING);
  await setBadge(tabId, '...', '#4A90E2');

  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'translate' });
  } catch (e) {
    await setBadge(tabId, '!', '#c0322b');
    tabState.set(tabId, STATE.U);
    await notify('Bilingual Translator', `Translation failed: ${e.message}`);
    setTimeout(() => setBadge(tabId, '', null), 4000);
    return;
  }

  if (res && res.ok) {
    tabState.set(tabId, STATE.S);
    if (typeof res.total === 'number') {
      const txt = res.success === res.total ? '' : `${res.success}/${res.total}`;
      await setBadge(tabId, txt, txt ? '#c0322b' : null);
      if (txt) setTimeout(() => setBadge(tabId, '', null), 4000);
    } else {
      await setBadge(tabId, '', null);
    }
  } else {
    tabState.set(tabId, STATE.U);
    await setBadge(tabId, '!', '#c0322b');
    await notify('Bilingual Translator', `Translation failed: ${(res && res.error) || 'unknown'}`);
    setTimeout(() => setBadge(tabId, '', null), 4000);
  }
});

// Handle batch translation requests from content scripts.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translateBatch') {
    (async () => {
      try {
        const cfg = await getConfig();
        if (!isConfigured(cfg)) throw new Error('Extension not configured');
        const text = await translate({ ...cfg, batchText: msg.text });
        sendResponse({ ok: true, text });
      } catch (e) {
        sendResponse({ ok: false, error: String(e.message || e) });
      }
    })();
    return true; // async
  }
});

// Reset state when tab closes or navigates away in main frame.
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    tabState.delete(details.tabId);
  }
});
