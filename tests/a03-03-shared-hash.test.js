import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 as cilHash } from '@sharpforge/cil';
import { sha256 as symbolsHash } from '@sharpforge/symbols';

for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 100000]) {
  test(`A03 shared SHA-256 matches native crypto with offset input (${size} bytes)`, () => {
    const backing = Uint8Array.from({ length: size + 9 }, (_, index) => index * 73 + 17 & 255);
    const input = backing.subarray(5, 5 + size), before = backing.slice();
    assert.equal(symbolsHash, cilHash, 'Both public APIs use the same implementation');
    const digest = cilHash(input);
    assert.equal(Buffer.from(digest).toString('hex'), createHash('sha256').update(input).digest('hex'));
    assert.deepEqual(backing, before);
    digest.fill(0);
    assert.notDeepEqual(cilHash(input), digest);
  });
}

test('A03 shared SHA-256 rejects non-byte input explicitly', () => {
  for (const input of [null, [], 'abc', new Uint16Array(3)]) assert.throws(() => cilHash(input), TypeError);
});
