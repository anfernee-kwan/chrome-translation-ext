import { translate } from './lib/providers.js';
import {
  DEFAULT_TARGET_LANGUAGE,
  getRuntimeLocaleCandidates,
  resolvePreferredTargetLanguage,
} from './lib/targetLanguages.js';

// Transient state for in-flight translations only. Persistent translation
// status (translated / hidden) lives in the content script and is queried
// per click via 'status' — this survives service-worker restarts.
const inFlight = new Set(); // tabIds currently being translated

async function getConfig() {
  const keys = ['provider', 'baseURL', 'apiKey', 'model', 'targetLanguage'];
  const cfg = await chrome.storage.local.get(keys);
  if (!cfg.targetLanguage) {
    cfg.targetLanguage = resolvePreferredTargetLanguage(getRuntimeLocaleCandidates()) || DEFAULT_TARGET_LANGUAGE;
  }
  return cfg;
}

function isConfigured(cfg) {
  return cfg && cfg.provider && cfg.baseURL && cfg.apiKey && cfg.model && cfg.targetLanguage;
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

function scheduleBadgeClear(tabId, seconds = 5) {
  // chrome.alarms survives SW restarts; setTimeout does not.
  chrome.alarms.create(`clearBadge:${tabId}`, { delayInMinutes: seconds / 60 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('clearBadge:')) {
    const tabId = parseInt(alarm.name.slice('clearBadge:'.length), 10);
    if (Number.isFinite(tabId)) setBadge(tabId, '', null);
  }
});

function isLifecycleError(e) {
  const m = String(e && e.message || e || '');
  return /Receiving end does not exist|message channel closed|Could not establish connection|context invalidated/i.test(m);
}

async function sendToTab(tabId, msg) {
  return await chrome.tabs.sendMessage(tabId, msg);
}

async function pingContent(tabId) {
  try {
    const r = await sendToTab(tabId, { type: 'ping' });
    return !!(r && r.ok);
  } catch {
    return false;
  }
}

async function getStatus(tabId) {
  try {
    const r = await sendToTab(tabId, { type: 'status' });
    if (r && r.ok) return { translated: !!r.translated, hidden: !!r.hidden };
  } catch {}
  return null;
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

  if (inFlight.has(tabId)) return; // ignore clicks during translation

  // Ask content script for ground-truth state. Survives SW restarts.
  const status = await getStatus(tabId);

  if (status && status.translated) {
    try {
      await sendToTab(tabId, { type: 'toggle' });
    } catch (e) {
      if (!isLifecycleError(e)) {
        console.warn('[bilingual] toggle failed', e);
      }
    }
    return;
  }

  // Untranslated -> translate.
  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    await notify('Bilingual Translator', 'Configure provider/baseURL/apiKey/model in the options page first.');
    return;
  }

  inFlight.add(tabId);
  await setBadge(tabId, '...', '#4A90E2');

  let res;
  try {
    res = await sendToTab(tabId, { type: 'translate' });
  } catch (e) {
    inFlight.delete(tabId);
    // Silent if the page navigated or was closed mid-translation.
    if (isLifecycleError(e)) {
      await setBadge(tabId, '', null);
      return;
    }
    await setBadge(tabId, '!', '#c0322b');
    await notify('Bilingual Translator', `Translation failed: ${e.message}`);
    scheduleBadgeClear(tabId);
    return;
  }

  inFlight.delete(tabId);

  if (res && res.ok) {
    if (typeof res.total === 'number' && res.success !== res.total) {
      await setBadge(tabId, `${res.success}/${res.total}`, '#c0322b');
      scheduleBadgeClear(tabId);
    } else {
      await setBadge(tabId, '', null);
    }
  } else {
    await setBadge(tabId, '!', '#c0322b');
    await notify('Bilingual Translator', `Translation failed: ${(res && res.error) || 'unknown'}`);
    scheduleBadgeClear(tabId);
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

// Clear in-flight tracking when tab closes or navigates away in main frame.
chrome.tabs.onRemoved.addListener((tabId) => {
  inFlight.delete(tabId);
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    inFlight.delete(details.tabId);
  }
});
