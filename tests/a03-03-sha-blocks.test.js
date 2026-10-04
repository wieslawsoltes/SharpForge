import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '@sharpforge/cil';

test('A03 SHA-256 matches native crypto across every tail and offset boundary', () => {
  for (let tail = 0; tail < 128; tail++) {
    const backing = Buffer.alloc(2048 + tail + 19);
    for (let index = 0; index < backing.length; index++) backing[index] = (index * 73 + tail) & 255;
    const input = backing.subarray(7, 2055 + tail);
    const original = Buffer.from(backing);
    const expected = createHash('sha256').update(input).digest('hex');
    assert.equal(Buffer.from(sha256(input)).toString('hex'), expected, `Tail ${tail}`);
    assert.deepEqual(backing, original, 'Hashing must not modify input or padding outside its view');
  }
});

test('A03 SHA-256 handles long messages with independent returned digests', () => {
  const input = new Uint8Array(1000000).fill(97);
  const expected = createHash('sha256').update(input).digest('hex');
  const first = sha256(input);
  assert.equal(Buffer.from(first).toString('hex'), expected);
  first.fill(0);
  assert.equal(Buffer.from(sha256(input)).toString('hex'), expected);
  assert.ok(input.every(value => value === 97));
});
