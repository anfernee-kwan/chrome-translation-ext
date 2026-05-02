# Bilingual Translation Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that, on toolbar icon click, translates an English webpage's paragraphs/headings/list-items/blockquotes/table-cells into Simplified Chinese using a user-configured Anthropic-compatible API, inserting translations inline beneath each original element. A second click toggles translations off; a third click toggles them back on (no re-fetch).

**Architecture:** MV3 service worker handles API calls (avoiding page CSP/CORS). Content script scans DOM, batches paragraphs (numbered `[N]` protocol), routes batches to background, and inserts translations. Provider abstraction layer keeps Anthropic-native and OpenAI-compatible adapters separable. Pure logic (provider, batch builder, response parser) is extracted into testable modules; DOM/Chrome-specific code is manually verified.

**Tech Stack:** Vanilla ES modules, Chrome Extension MV3 APIs (`chrome.action`, `chrome.runtime`, `chrome.storage.local`, `chrome.notifications`, `chrome.tabs`, `chrome.webNavigation`), Node.js built-in `node:test` for unit tests on pure logic.

---

## File Structure

```
chrome-translation-ext/
├── manifest.json              # MV3 manifest
├── background.js              # service worker (entry)
├── content.js                 # content script (entry)
├── content.css                # injected styles
├── options.html               # options form
├── options.js                 # options form logic
├── lib/
│   ├── providers.js           # provider abstraction (anthropic + stub openai)
│   ├── batcher.js             # pure: split paragraphs into numbered batches
│   └── parser.js              # pure: parse "[N] text" model output → Map
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── tests/
│   ├── batcher.test.js
│   ├── parser.test.js
│   └── providers.test.js
├── package.json               # only for node:test runner
└── docs/superpowers/...       # design + plan docs (already exist)
```

**File responsibilities:**
- `lib/batcher.js`: pure function `buildBatches(items, {maxChars, maxItems})` → `Batch[]`. Each item has `{id, text}`. Each batch has `{ids, text}` where `text` is `[1] ...\n[2] ...`. **Numbering restarts per batch (1..N).** A side map per batch links local index → global id.
- `lib/parser.js`: pure function `parseNumberedResponse(text, expectedCount)` → `Map<number, string>` (1-indexed local numbers).
- `lib/providers.js`: `translate({ provider, baseURL, apiKey, model, batchText })` → `Promise<string>` (raw model text). Routes to `anthropicTranslate` (implemented) or `openaiTranslate` (throws "not implemented" stub).
- `background.js`: action click handler, per-tab state map, message routing, badge/notification side effects.
- `content.js`: scan DOM, build items, request batches via background, parse + insert translations, toggle visibility.
- `options.{html,js}`: form for provider/baseURL/apiKey/model + "Test connection" button.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png` (placeholder solid-color PNGs)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "chrome-translation-ext",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
.claude/settings.local.json
```

- [ ] **Step 3: Create placeholder icons**

Run:
```bash
cd /Users/anfernee/projects/chrome-translation-ext
mkdir -p icons
# Generate three solid blue PNGs using built-in macOS sips, or use printf trick
# Simpler: write a tiny 1x1 PNG and let Chrome scale it (acceptable for personal dev)
python3 -c "
import struct, zlib, os
def png(size, path):
    # solid #4A90E2 RGBA
    raw = b''.join(b'\x00' + b'\x4A\x90\xE2\xFF' * size for _ in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(raw)
    with open(path,'wb') as f:
        f.write(sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))
for s in (16,48,128):
    png(s, f'icons/icon-{s}.png')
print('done')
"
ls icons/
```
Expected: `icon-16.png  icon-48.png  icon-128.png`

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore icons/
git commit -m "chore: project scaffolding (package.json, gitignore, placeholder icons)"
```

---

## Task 2: Batcher (pure logic, TDD)

**Files:**
- Create: `lib/batcher.js`
- Test: `tests/batcher.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/batcher.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBatches } from '../lib/batcher.js';

test('buildBatches: empty input returns empty array', () => {
  assert.deepEqual(buildBatches([], { maxChars: 2000, maxItems: 20 }), []);
});

test('buildBatches: single item produces one batch with [1] prefix', () => {
  const items = [{ id: 'a', text: 'hello world' }];
  const batches = buildBatches(items, { maxChars: 2000, maxItems: 20 });
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].ids, ['a']);
  assert.equal(batches[0].text, '[1] hello world');
});

test('buildBatches: numbering restarts each batch', () => {
  // Force two batches by tiny maxItems
  const items = [
    { id: 'x', text: 'one' },
    { id: 'y', text: 'two' },
    { id: 'z', text: 'three' },
  ];
  const batches = buildBatches(items, { maxChars: 1000, maxItems: 2 });
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].ids, ['x', 'y']);
  assert.equal(batches[0].text, '[1] one\n[2] two');
  assert.deepEqual(batches[1].ids, ['z']);
  assert.equal(batches[1].text, '[1] three');
});

test('buildBatches: splits when char budget exceeded', () => {
  const items = [
    { id: 'a', text: 'x'.repeat(900) },
    { id: 'b', text: 'y'.repeat(900) },
    { id: 'c', text: 'z'.repeat(900) },
  ];
  const batches = buildBatches(items, { maxChars: 2000, maxItems: 20 });
  // a+b ~ 1800 chars fit; c alone in batch 2
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].ids, ['a', 'b']);
  assert.deepEqual(batches[1].ids, ['c']);
});

test('buildBatches: oversized single item still gets its own batch', () => {
  const items = [{ id: 'big', text: 'x'.repeat(5000) }];
  const batches = buildBatches(items, { maxChars: 2000, maxItems: 20 });
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].ids, ['big']);
});

test('buildBatches: text with newlines is collapsed to spaces', () => {
  const items = [{ id: 'a', text: 'line1\nline2\n  line3' }];
  const batches = buildBatches(items, { maxChars: 2000, maxItems: 20 });
  assert.equal(batches[0].text, '[1] line1 line2 line3');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — "Cannot find module '../lib/batcher.js'"

- [ ] **Step 3: Implement batcher**

Create `lib/batcher.js`:

```js
// Build numbered batches. Numbering is local to each batch (1..N).
// Returns: Array<{ ids: string[], text: string }>
export function buildBatches(items, { maxChars, maxItems }) {
  const batches = [];
  let cur = { ids: [], lines: [], chars: 0 };

  const flush = () => {
    if (cur.ids.length === 0) return;
    batches.push({ ids: cur.ids, text: cur.lines.join('\n') });
    cur = { ids: [], lines: [], chars: 0 };
  };

  for (const item of items) {
    const cleaned = item.text.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const projected = cur.chars + cleaned.length;
    const overChars = cur.ids.length > 0 && projected > maxChars;
    const overItems = cur.ids.length >= maxItems;
    if (overChars || overItems) flush();
    const localN = cur.ids.length + 1;
    cur.ids.push(item.id);
    cur.lines.push(`[${localN}] ${cleaned}`);
    cur.chars += cleaned.length;
  }
  flush();
  return batches;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/batcher.js tests/batcher.test.js package.json
git commit -m "feat(batcher): split paragraphs into numbered batches with char/item limits"
```

---

## Task 3: Response parser (pure logic, TDD)

**Files:**
- Create: `lib/parser.js`
- Test: `tests/parser.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/parser.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumberedResponse } from '../lib/parser.js';

test('parser: parses simple [N] text format', () => {
  const out = parseNumberedResponse('[1] hello\n[2] world', 2);
  assert.equal(out.size, 2);
  assert.equal(out.get(1), 'hello');
  assert.equal(out.get(2), 'world');
});

test('parser: tolerates surrounding whitespace and blank lines', () => {
  const out = parseNumberedResponse('\n\n[1]   foo  \n\n[2]\tbar\n', 2);
  assert.equal(out.get(1), 'foo');
  assert.equal(out.get(2), 'bar');
});

test('parser: tolerates leading explanation prefix', () => {
  const out = parseNumberedResponse('Here are translations:\n[1] a\n[2] b', 2);
  assert.equal(out.get(1), 'a');
  assert.equal(out.get(2), 'b');
});

test('parser: missing entry produces incomplete map (caller decides fallback)', () => {
  const out = parseNumberedResponse('[1] only-one', 3);
  assert.equal(out.size, 1);
  assert.equal(out.get(1), 'only-one');
  assert.equal(out.has(2), false);
});

test('parser: out-of-order numbering still maps correctly', () => {
  const out = parseNumberedResponse('[2] second\n[1] first', 2);
  assert.equal(out.get(1), 'first');
  assert.equal(out.get(2), 'second');
});

test('parser: numbers beyond expectedCount are ignored', () => {
  const out = parseNumberedResponse('[1] a\n[2] b\n[3] extra', 2);
  assert.equal(out.size, 2);
  assert.equal(out.has(3), false);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: parser tests fail (module missing); batcher tests still pass.

- [ ] **Step 3: Implement parser**

Create `lib/parser.js`:

```js
// Parse a model response of the form "[1] text\n[2] text\n..." into a Map.
// Numbers > expectedCount are ignored. Missing numbers are absent from the map.
// Multi-line content under a single [N] header is concatenated with spaces.
export function parseNumberedResponse(text, expectedCount) {
  const result = new Map();
  if (!text || typeof text !== 'string') return result;

  const lines = text.split(/\r?\n/);
  let curNum = null;
  let curBuf = [];

  const commit = () => {
    if (curNum !== null && curNum >= 1 && curNum <= expectedCount) {
      const joined = curBuf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) result.set(curNum, joined);
    }
    curNum = null;
    curBuf = [];
  };

  const headerRe = /^\s*\[(\d+)\]\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      commit();
      curNum = parseInt(m[1], 10);
      if (m[2]) curBuf.push(m[2]);
    } else if (curNum !== null) {
      const trimmed = line.trim();
      if (trimmed) curBuf.push(trimmed);
    }
  }
  commit();
  return result;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all batcher + parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/parser.js tests/parser.test.js
git commit -m "feat(parser): parse numbered [N] model responses into Map"
```

---

## Task 4: Provider abstraction (Anthropic, TDD with mocked fetch)

**Files:**
- Create: `lib/providers.js`
- Test: `tests/providers.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/providers.test.js`:

```js
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { translate, anthropicTranslate } from '../lib/providers.js';

let originalFetch;
let lastCall;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  lastCall = null;
  globalThis.fetch = async (url, init) => {
    lastCall = { url, init };
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: '[1] 你好' }] }),
    };
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

test('anthropicTranslate: posts to /v1/messages with correct headers and body', async () => {
  const out = await anthropicTranslate({
    baseURL: 'https://api.example.com',
    apiKey: 'sk-test',
    model: 'claude-haiku-4-5-20251001',
    batchText: '[1] hello',
  });
  assert.equal(out, '[1] 你好');
  assert.equal(lastCall.url, 'https://api.example.com/v1/messages');
  assert.equal(lastCall.init.method, 'POST');
  assert.equal(lastCall.init.headers['x-api-key'], 'sk-test');
  assert.equal(lastCall.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(lastCall.init.headers['content-type'], 'application/json');
  const body = JSON.parse(lastCall.init.body);
  assert.equal(body.model, 'claude-haiku-4-5-20251001');
  assert.equal(body.max_tokens, 4096);
  assert.match(body.system, /编号/);
  assert.deepEqual(body.messages, [{ role: 'user', content: '[1] hello' }]);
});

test('anthropicTranslate: trailing slash in baseURL is normalized', async () => {
  await anthropicTranslate({
    baseURL: 'https://api.example.com/',
    apiKey: 'k', model: 'm', batchText: '[1] x',
  });
  assert.equal(lastCall.url, 'https://api.example.com/v1/messages');
});

test('anthropicTranslate: throws on non-ok response', async () => {
  globalThis.fetch = async () => ({
    ok: false, status: 401,
    text: async () => 'unauthorized',
  });
  await assert.rejects(
    anthropicTranslate({ baseURL: 'https://x', apiKey: 'k', model: 'm', batchText: 't' }),
    /401/,
  );
});

test('translate: routes to anthropic provider', async () => {
  const out = await translate({
    provider: 'anthropic',
    baseURL: 'https://api.example.com',
    apiKey: 'k', model: 'm', batchText: '[1] hi',
  });
  assert.equal(out, '[1] 你好');
});

test('translate: openai-compatible provider stub throws not-implemented', async () => {
  await assert.rejects(
    translate({ provider: 'openai-compatible', baseURL: 'x', apiKey: 'k', model: 'm', batchText: 't' }),
    /not implemented/i,
  );
});

test('translate: unknown provider throws', async () => {
  await assert.rejects(
    translate({ provider: 'bogus', baseURL: 'x', apiKey: 'k', model: 'm', batchText: 't' }),
    /unknown provider/i,
  );
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: providers tests fail (module missing).

- [ ] **Step 3: Implement provider**

Create `lib/providers.js`:

```js
export const SYSTEM_PROMPT = `你是专业翻译。将下面带编号的英文段落翻译成简体中文。
要求：
1. 严格保留编号格式 [N] 译文
2. 每段译文一行，不要换行
3. 不要添加任何解释、前言、总结
4. 专业术语和人名/地名按惯例翻译，不确定时保留原文`;

function trimTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export async function anthropicTranslate({ baseURL, apiKey, model, batchText }) {
  const url = `${trimTrailingSlash(baseURL)}/v1/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: batchText }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Anthropic API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('Anthropic API returned no text content');
  return block.text;
}

export async function openaiTranslate(_args) {
  throw new Error('openai-compatible provider not implemented yet');
}

export async function translate({ provider, ...rest }) {
  switch (provider) {
    case 'anthropic': return anthropicTranslate(rest);
    case 'openai-compatible': return openaiTranslate(rest);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all tests pass (batcher + parser + providers).

- [ ] **Step 5: Commit**

```bash
git add lib/providers.js tests/providers.test.js
git commit -m "feat(providers): anthropic-native provider with translate() router"
```

---

## Task 5: Manifest

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Bilingual Translator",
  "version": "0.1.0",
  "description": "Translate foreign-language pages to Simplified Chinese inline, side-by-side with the original.",
  "permissions": ["storage", "scripting", "notifications", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    },
    "default_title": "Translate this page"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "options_page": "options.html",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"],
    "css": ["content.css"],
    "run_at": "document_idle"
  }]
}
```

- [ ] **Step 2: Validate manifest by loading in Chrome**

Manual verification:
1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `/Users/anfernee/projects/chrome-translation-ext`
4. Expected: extension loads with no manifest errors. Icon appears in toolbar. Clicking icon does nothing yet (no handler).
5. Click "Errors" link if present — expected none.

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: add MV3 manifest"
```

---

## Task 6: Options page

**Files:**
- Create: `options.html`
- Create: `options.js`

- [ ] **Step 1: Create `options.html`**

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Bilingual Translator – Options</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 520px; margin: 24px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 20px; }
    label { display: block; margin: 12px 0 4px; font-weight: 600; font-size: 13px; }
    input, select { width: 100%; padding: 8px; box-sizing: border-box; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; }
    button { margin-top: 16px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
    .row { display: flex; gap: 8px; align-items: center; }
    .row button { margin: 0; }
    #status { margin-top: 12px; font-size: 13px; }
    .ok { color: #1a7f37; }
    .err { color: #c0322b; }
    .hint { font-size: 12px; color: #666; margin-top: 2px; }
  </style>
</head>
<body>
  <h1>Bilingual Translator</h1>

  <label for="provider">Provider</label>
  <select id="provider">
    <option value="anthropic">Anthropic (native /v1/messages)</option>
    <option value="openai-compatible" disabled>OpenAI-compatible (not implemented)</option>
  </select>

  <label for="baseURL">Base URL</label>
  <input id="baseURL" type="text" placeholder="https://api.anthropic.com">
  <div class="hint">Without trailing slash. The extension will POST to {baseURL}/v1/messages.</div>

  <label for="apiKey">API Key</label>
  <input id="apiKey" type="password" placeholder="sk-...">

  <label for="model">Model</label>
  <input id="model" type="text" placeholder="claude-haiku-4-5-20251001">

  <div class="row">
    <button id="save">Save</button>
    <button id="test">Test connection</button>
  </div>
  <div id="status"></div>

  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `options.js`**

```js
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
```

- [ ] **Step 3: Manual verification**

1. Reload extension in `chrome://extensions` (click refresh icon on the extension card).
2. Right-click extension icon → "Options". Page opens.
3. Fill in baseURL, apiKey, model. Click "Save". Status shows "Saved."
4. Click "Test connection". Status shows "OK. Sample response: [1] 你好世界" (or similar).
5. Reopen options page; values are persisted.

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat(options): add config form with test-connection button"
```

---

## Task 7: Content CSS

**Files:**
- Create: `content.css`

- [ ] **Step 1: Write `content.css`**

```css
.__tr_zh {
  display: block;
  margin: 4px 0 8px 0;
  padding-left: 8px;
  border-left: 3px solid #ccc;
  color: #666;
  font-size: 0.95em;
  line-height: 1.5;
  font-family: inherit;
  white-space: normal;
}
body.__tr_hidden .__tr_zh {
  display: none !important;
}
td .__tr_zh,
li .__tr_zh {
  margin: 2px 0 0 0;
}
.__tr_busy {
  outline: 2px dashed rgba(74, 144, 226, 0.5);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Commit**

```bash
git add content.css
git commit -m "feat(styles): translation block styling and busy outline"
```

---

## Task 8: Content script

**Files:**
- Create: `content.js`

- [ ] **Step 1: Write `content.js`**

```js
// Content script. Cannot use ES module imports in MV3 content scripts directly,
// so the batcher/parser logic is duplicated here intentionally — these modules
// remain the source of truth and are unit-tested. Keep them in sync.

const SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td';
const MIN_LEN = 4;
const CN_RATIO_SKIP = 0.5;
const MAX_CHARS = 2000;
const MAX_ITEMS = 20;
const CONCURRENCY = 3;

function isMostlyChinese(text) {
  const total = text.length;
  if (total === 0) return false;
  let cn = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code >= 0x4e00 && code <= 0x9fff) cn++;
  }
  return cn / total >= CN_RATIO_SKIP;
}

function shouldSkip(el) {
  if (el.closest('code, pre, script, style, textarea, [contenteditable="true"]')) return true;
  if (el.querySelector('p, li, h1, h2, h3, h4, h5, h6, blockquote, td')) return true; // container, not leaf
  if (el.dataset.trDone === '1') return true;
  return false;
}

function collectItems() {
  const out = [];
  let counter = 0;
  document.querySelectorAll(SELECTOR).forEach((el) => {
    if (shouldSkip(el)) return;
    const text = (el.innerText || '').trim();
    if (text.length < MIN_LEN) return;
    if (isMostlyChinese(text)) return;
    const id = `tr-${++counter}`;
    el.dataset.trId = id;
    out.push({ id, text, el });
  });
  return out;
}

function buildBatches(items, { maxChars, maxItems }) {
  const batches = [];
  let cur = { ids: [], lines: [], chars: 0, els: [] };
  const flush = () => {
    if (cur.ids.length === 0) return;
    batches.push({ ids: cur.ids, text: cur.lines.join('\n'), els: cur.els });
    cur = { ids: [], lines: [], chars: 0, els: [] };
  };
  for (const item of items) {
    const cleaned = item.text.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const projected = cur.chars + cleaned.length;
    const overChars = cur.ids.length > 0 && projected > maxChars;
    const overItems = cur.ids.length >= maxItems;
    if (overChars || overItems) flush();
    const localN = cur.ids.length + 1;
    cur.ids.push(item.id);
    cur.lines.push(`[${localN}] ${cleaned}`);
    cur.chars += cleaned.length;
    cur.els.push(item.el);
  }
  flush();
  return batches;
}

function parseNumberedResponse(text, expectedCount) {
  const result = new Map();
  if (!text || typeof text !== 'string') return result;
  const lines = text.split(/\r?\n/);
  let curNum = null;
  let curBuf = [];
  const commit = () => {
    if (curNum !== null && curNum >= 1 && curNum <= expectedCount) {
      const joined = curBuf.join(' ').replace(/\s+/g, ' ').trim();
      if (joined) result.set(curNum, joined);
    }
    curNum = null; curBuf = [];
  };
  const headerRe = /^\s*\[(\d+)\]\s*(.*)$/;
  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      commit();
      curNum = parseInt(m[1], 10);
      if (m[2]) curBuf.push(m[2]);
    } else if (curNum !== null) {
      const t = line.trim();
      if (t) curBuf.push(t);
    }
  }
  commit();
  return result;
}

function insertTranslation(el, zh) {
  if (!el || !el.parentNode) return;
  if (el.dataset.trDone === '1') return;
  const node = document.createElement('div');
  node.className = '__tr_zh';
  node.dataset.trOf = el.dataset.trId || '';
  node.textContent = zh;
  el.insertAdjacentElement('afterend', node);
  el.dataset.trDone = '1';
}

async function translateBatchViaBg(text) {
  const res = await chrome.runtime.sendMessage({ type: 'translateBatch', text });
  if (!res || !res.ok) throw new Error((res && res.error) || 'no response');
  return res.text;
}

async function processBatch(batch) {
  batch.els.forEach((e) => e.classList.add('__tr_busy'));
  try {
    const raw = await translateBatchViaBg(batch.text);
    const map = parseNumberedResponse(raw, batch.ids.length);
    let missing = [];
    for (let i = 0; i < batch.ids.length; i++) {
      const zh = map.get(i + 1);
      if (zh) insertTranslation(batch.els[i], zh);
      else missing.push(i);
    }
    // Fallback: retry missing ones individually (one shot each)
    for (const i of missing) {
      try {
        const single = await translateBatchViaBg(`[1] ${batch.els[i].innerText.replace(/\s+/g, ' ').trim()}`);
        const m2 = parseNumberedResponse(single, 1);
        const zh = m2.get(1);
        if (zh) insertTranslation(batch.els[i], zh);
      } catch (e) {
        console.warn('[bilingual] single retry failed', e);
      }
    }
    return { ok: true };
  } catch (e) {
    console.warn('[bilingual] batch failed', e);
    return { ok: false, error: String(e.message || e) };
  } finally {
    batch.els.forEach((e) => e.classList.remove('__tr_busy'));
  }
}

async function runConcurrent(batches, n) {
  const results = new Array(batches.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, batches.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= batches.length) return;
      results[i] = await processBatch(batches[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

let translated = false;

async function doTranslate() {
  if (translated) return { ok: true, alreadyTranslated: true };
  const items = collectItems();
  if (items.length === 0) return { ok: true, total: 0, success: 0 };
  const batches = buildBatches(items, { maxChars: MAX_CHARS, maxItems: MAX_ITEMS });
  const results = await runConcurrent(batches, CONCURRENCY);
  translated = true;
  document.body.classList.remove('__tr_hidden');
  const success = results.filter((r) => r && r.ok).length;
  return { ok: true, total: batches.length, success };
}

function doToggle() {
  document.body.classList.toggle('__tr_hidden');
  return { ok: true, hidden: document.body.classList.contains('__tr_hidden') };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    doTranslate().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg && msg.type === 'toggle') {
    sendResponse(doToggle());
    return false;
  }
  if (msg && msg.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add content.js
git commit -m "feat(content): scan/batch/insert translations and toggle visibility"
```

---

## Task 9: Background service worker

**Files:**
- Create: `background.js`

- [ ] **Step 1: Write `background.js`**

```js
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

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const tabId = tab.id;

  if (!(await pingContent(tabId))) {
    await notify('Bilingual Translator', 'This page does not support translation (chrome://, PDF viewer, or restricted page).');
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
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat(background): action handler, state machine, batch routing"
```

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Reload extension**

In `chrome://extensions`, click the refresh icon on the extension card. Expected: no errors in service worker logs (click "service worker" link to inspect).

- [ ] **Step 2: Configure**

Open options page, set baseURL/apiKey/model, click Save, click Test connection — should print `OK. Sample response: [1] 你好世界` or similar.

- [ ] **Step 3: Test on Wikipedia**

1. Visit `https://en.wikipedia.org/wiki/Domestic_canary` (or any English Wikipedia article).
2. Click extension icon. Badge shows "..." while translating.
3. Expected: within ~10–30 seconds, each `<p>`, `<h2>`, `<li>`, table cell gets a Chinese translation block beneath it, in light gray with a left border.
4. Click extension icon again. All translation blocks hide.
5. Click again. They reappear (no API call this time — instant).

- [ ] **Step 4: Test on Hacker News**

1. Visit `https://news.ycombinator.com/item?id=<any large story>`.
2. Click icon. Comments translate.
3. Verify short titles/usernames in the page chrome are NOT translated (they should be filtered by length or selector).

- [ ] **Step 5: Test on already-Chinese page**

Visit `https://zh.wikipedia.org/wiki/...`. Click icon. Expected: most paragraphs are skipped (Chinese-ratio filter); badge shows `0/0` or briefly `...` then clears.

- [ ] **Step 6: Test on chrome:// page**

Open `chrome://settings`. Click icon. Expected: notification appears: "This page does not support translation…". No errors.

- [ ] **Step 7: Test missing config**

In options page, clear apiKey, save. Visit a fresh tab → English page → click icon. Expected: notification "Configure provider/baseURL/apiKey/model in the options page first."

- [ ] **Step 8: Commit any fixes from manual testing**

If any issues surfaced, fix them and commit.

```bash
git status
# If clean:
echo "Manual verification complete."
```

---

## Self-Review Notes

- All spec sections covered: scaffolding (T1) → manifest (T5) → options (T6) → CSS (T7) → content script (T8) → background (T9) → E2E manual (T10), with provider/batcher/parser unit-tested (T2–T4).
- Content script intentionally duplicates `buildBatches`/`parseNumberedResponse` from `lib/` because MV3 content scripts cannot import ES modules from extension files without `chrome.runtime.getURL` + dynamic import gymnastics; the duplication is documented at the top of `content.js` and the lib versions stay authoritative + tested.
- Type/name consistency: message types `translate`, `toggle`, `ping`, `translateBatch`; state values `untranslated|translating|shown|hidden`; CSS classes `__tr_zh`, `__tr_hidden`, `__tr_busy`; data attributes `data-tr-id`, `data-tr-done`, `data-tr-of`. Used identically across content.js and background.js.
- No placeholders, no TBDs, every code step shows full code.
