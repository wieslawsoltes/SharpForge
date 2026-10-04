import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder } from '@sharpforge/cil';

for (const kind of ['blob', 'guid']) {
  test(`A03 ${kind} interning owns Buffer bytes after insertion`, () => {
    const metadata = new MetadataBuilder('BufferInterning');
    const carrier = Buffer.from(Array.from({ length: 24 }, (_, index) => index));
    const bytes = carrier.subarray(3, 19), original = new Uint8Array(bytes);
    const handle = metadata[kind](bytes);
    bytes.fill(0);
    assert.equal(metadata[kind](original), handle);
    assert.notEqual(metadata[kind](bytes), handle);
  });
}
