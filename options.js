import { translate } from './lib/providers.js';
import {
  DEFAULT_TARGET_LANGUAGE,
  TARGET_LANGUAGES,
  getRuntimeLocaleCandidates,
  resolvePreferredTargetLanguage,
} from './lib/targetLanguages.js';

const $ = (id) => document.getElementById(id);
const storage = typeof chrome !== 'undefined' ? chrome.storage?.local : null;
const configurableFields = ['provider', 'baseURL', 'apiKey', 'model', 'targetLanguage'];
const defaultTargetLanguage = resolvePreferredTargetLanguage(getRuntimeLocaleCandidates());
const DEFAULTS = {
  provider: 'anthropic',
  baseURL: '',
  apiKey: '',
  model: 'claude-haiku-4-5-20251001',
  targetLanguage: defaultTargetLanguage || DEFAULT_TARGET_LANGUAGE,
};

function renderTargetLanguageOptions(selectedValue) {
  const select = $('targetLanguage');
  select.textContent = '';
  for (const language of TARGET_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.value;
    option.textContent = `${language.label} (${language.speakerCount})`;
    if (language.value === selectedValue) option.selected = true;
    select.appendChild(option);
  }
}

async function load() {
  const stored = storage ? await storage.get(configurableFields) : {};
  const targetLanguage = stored.targetLanguage || DEFAULTS.targetLanguage;
  renderTargetLanguageOptions(targetLanguage);
  for (const field of configurableFields) {
    $(field).value = stored[field] ?? DEFAULTS[field];
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
  for (const field of configurableFields) {
    const value = $(field).value;
    data[field] = field === 'targetLanguage' ? value : value.trim();
  }
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
  for (const field of configurableFields) {
    const value = $(field).value;
    cfg[field] = field === 'targetLanguage' ? value : value.trim();
  }
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
