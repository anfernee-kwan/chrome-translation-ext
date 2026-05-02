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
