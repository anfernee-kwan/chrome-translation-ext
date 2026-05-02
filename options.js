import { translate } from './lib/providers.js';

const $ = (id) => document.getElementById(id);
const fields = ['provider', 'baseURL', 'apiKey', 'model'];
const DEFAULTS = {
  provider: 'anthropic',
  baseURL: '',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
};

async function load() {
  const stored = await chrome.storage.local.get(fields);
  for (const f of fields) {
    $(f).value = stored[f] ?? DEFAULTS[f];
  }
}

async function save() {
  const data = {};
  for (const f of fields) data[f] = $(f).value.trim();
  await chrome.storage.local.set(data);
  setStatus('Saved.', 'ok');
}

function setStatus(msg, cls = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = cls;
}

async function testConnection() {
  setStatus('Testing…');
  const cfg = {};
  for (const f of fields) cfg[f] = $(f).value.trim();
  if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
    setStatus('Fill in baseURL, apiKey, and model first.', 'err');
    return;
  }
  try {
    const out = await translate({ ...cfg, batchText: '[1] hello world' });
    setStatus(`OK. Sample response: ${out.slice(0, 120)}`, 'ok');
  } catch (e) {
    setStatus(`FAILED: ${e.message}`, 'err');
  }
}

$('save').addEventListener('click', save);
$('test').addEventListener('click', testConnection);
load();
