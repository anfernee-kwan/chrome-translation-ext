// Content script. Cannot use ES module imports in MV3 content scripts directly,
// so the batcher/parser logic is duplicated here intentionally — these modules
// remain the source of truth and are unit-tested. Keep them in sync.

const SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td',
  // SPA / semantic content containers that hold paragraph-like text without using <p>.
  'article',
  'div[lang]', 'span[lang]',
  'div[data-testid="tweetText"]',
  '[role="article"]',
  // X/Twitter long-form articles use Draft.js: each paragraph is .public-DraftStyleDefault-block
  '.public-DraftStyleDefault-block',
].join(', ');
const LEAF_BLOCKER = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, article, [data-testid="tweetText"], .public-DraftStyleDefault-block';
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
  if (el.querySelector(LEAF_BLOCKER)) return true; // container, not leaf
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
