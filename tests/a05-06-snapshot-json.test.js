import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSnapshotJSON, assertSnapshotText, snapshotJSONString} from '../packages/runtime/src/execution/snapshot-json.js';

const limits = {maxBytes: 1024, maxItems: 1024};

test('snapshot JSON bounds include escaping, Unicode scalars, lone surrogates and property names', () => {
  const input = {'\u0000\"\\': ['\u0001\b\t\n\f\r', '\ud800', '\udc00', '\ud83d\ude00', '\u20ac', '\u0080', -0, 1e300, true, false, null]};
  const text = JSON.stringify(input), bytes = new TextEncoder().encode(text).byteLength;
  assert.equal(assertSnapshotJSON(input, limits), bytes);
  assert.equal(snapshotJSONString(input, {...limits, maxBytes: bytes}), text);
  assert.throws(() => snapshotJSONString(input, {...limits, maxBytes: bytes - 1}), error => error.code === 'SNAPSHOT_LIMIT');
  assert.throws(() => snapshotJSONString({escaped: '\u0000'.repeat(20)}, {...limits, maxBytes: 32}), /byte limit/);
});

test('snapshot JSON rejects sparse expansion and non-enumerable hooks or accessors without invoking them', () => {
  let called = false;
  const hook = Object.defineProperty({}, 'toJSON', {value() { called = true; return {}; }});
  assert.throws(() => snapshotJSONString(hook, limits), /hooks/);
  const accessor = [];
  Object.defineProperty(accessor, '0', {get() { called = true; return null; }});
  assert.throws(() => snapshotJSONString(accessor, limits), /accessors/);
  assert.throws(() => snapshotJSONString(new Array(1), limits), /sparse/);
  assert.throws(() => snapshotJSONString(new Array(1000000), limits), /container limit/);
  assert.equal(called, false);
});

test('snapshot JSON depth and alias limits are checked before serialization', () => {
  const alias = {};
  assert.throws(() => snapshotJSONString([alias, alias], limits), /numbered graph references/);
  const root = [];
  root.push(root);
  assert.throws(() => snapshotJSONString(root, limits), /numbered graph references/);
  let deep = null;
  for (let index = 0; index < 130; index++) deep = [deep];
  assert.throws(() => snapshotJSONString(deep, limits), /nesting/);
});

test('snapshot JSON text limits count UTF-8 without materializing another encoded buffer', () => {
  for (const text of ['plain', '\u0080\u20ac', '\ud800', '\udc00', '\ud83d\ude00']) {
    const bytes = new TextEncoder().encode(text).byteLength;
    assert.equal(assertSnapshotText(text, {...limits, maxBytes: bytes}), bytes);
    assert.throws(() => assertSnapshotText(text, {...limits, maxBytes: bytes - 1}), /byte limit/);
  }
  assert.throws(() => assertSnapshotText(' '.repeat(1025), limits), /byte limit/);
});
