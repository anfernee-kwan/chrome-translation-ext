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
