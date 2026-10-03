import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { deflateRaw, inflateRaw } from '@sharpforge/archive';

function deterministicBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x12345678;
  for (let index = 0; index < length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state;
  }
  return bytes;
}

for (const size of [0, 1, 2, 3, 258, 32768, 32769, 65535, 65536, 100000]) {
  test('fixed Huffman encoder interoperates with platform zlib at size ' + size, () => {
    const bytes = deterministicBytes(size);
    const before = bytes.slice();
    const compressed = deflateRaw(bytes);
    assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), bytes);
    assert.deepEqual(inflateRaw(compressed, size), bytes);
    assert.deepEqual(bytes, before);
    assert.deepEqual(deflateRaw(bytes), compressed);
    assert(compressed.length <= Math.ceil(size * 9 / 8) + 6);
  });
}

test('repetitive source and maximum overlap matches shrink below forty percent', () => {
  for (const bytes of [new Uint8Array(100000).fill(97), new TextEncoder().encode(
    'namespace Example { public class Test { public int Value => 42; } }\n'.repeat(1000)),
  ]) {
    const compressed = deflateRaw(bytes);
    assert(compressed.length < bytes.length * 0.4);
    assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), bytes);
    assert.deepEqual(inflateRaw(compressed, bytes.length), bytes);
  }
});

test('encoder bounds and cancellation fail before allocating its window', () => {
  assert.throws(() => deflateRaw([]), TypeError);
  assert.throws(() => deflateRaw(new Uint8Array(2), { maxBytes: 1 }), RangeError);
  assert.throws(() => deflateRaw(new Uint8Array(), { maxBytes: -1 }), RangeError);
  for (const maxChain of [0, 65, 1.5, Infinity]) {
    assert.throws(() => deflateRaw(new Uint8Array(), { maxChain }), RangeError);
  }
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => deflateRaw(new Uint8Array(1000), { signal: controller.signal }), { name: 'AbortError' });
});

test('minimum and maximum search budgets retain exact bytes and bounded output', () => {
  const bytes = deterministicBytes(70000);
  bytes.set(bytes.subarray(0, 32768), 32768);
  for (const maxChain of [1, 64]) {
    const compressed = deflateRaw(bytes, { maxChain });
    assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), bytes);
    assert(compressed.length <= Math.ceil(bytes.length * 9 / 8) + 6);
    assert.throws(() => inflateRaw(compressed.subarray(0, compressed.length - 1), bytes.length));
  }
});
