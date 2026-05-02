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
