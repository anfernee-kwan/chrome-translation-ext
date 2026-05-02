import { translate } from './lib/providers.js';

const $ = (id) => document.getElementById(id);
const fields = ['provider', 'baseURL', 'apiKey', 'model'];
const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
const DEFAULTS = {
  provider: 'anthropic',
  baseURL: '',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
};

async function load() {
  const stored = storage ? await storage.get(fields) : {};
  for (const f of fields) {
    $(f).value = stored[f] ?? DEFAULTS[f];
  }
  if (!storage) {
    setStatus('Preview mode: storage APIs are unavailable outside the extension.', 'info');
  }
}

async function save() {
  if (!storage) {
    setStatus('Preview mode: saving is only available inside the extension.', 'err');
    return;
  }
  const data = {};
  for (const f of fields) data[f] = $(f).value.trim();
  await storage.set(data);
  setStatus('Saved.', 'ok');
}

function setStatus(msg, cls = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = `status${msg ? ' is-visible' : ''}${cls ? ` ${cls}` : ''}`;
}

async function testConnection() {
  const testButton = $('test');
  testButton.disabled = true;
  setStatus('Testing connection...', 'info');
  const cfg = {};
  for (const f of fields) cfg[f] = $(f).value.trim();
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    setStatus('Fill in baseURL, apiKey, and model first.', 'err');
    testButton.disabled = false;
    return;
  }
  try {
    const out = await translate({ ...cfg, batchText: '[1] hello world' });
    setStatus(`OK. Sample response: ${out.slice(0, 120)}`, 'ok');
  } catch (e) {
    setStatus(`FAILED: ${e.message}`, 'err');
  } finally {
    testButton.disabled = false;
  }
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', testConnection);
load();
