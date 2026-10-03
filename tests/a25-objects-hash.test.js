import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IncrementalHash, hashBytes, hashObject } from '../packages/git/src/hash.js';
import { getObjectFormat, bytesToHex, hexToBytes, validateObjectId } from '../packages/git/src/object-format.js';

const encoder = new TextEncoder();
const reference = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');

test('Git empty objects match the published SHA-1 IDs and SHA-256 framing', async () => {
  assert.equal(await hashObject('blob', new Uint8Array()), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  assert.equal(await hashObject('tree', new Uint8Array()), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  for (const type of ['blob', 'tree', 'commit', 'tag']) {
    const expected = reference('sha256', encoder.encode(`${type} 0\0`));
    assert.equal(await hashObject(type, new Uint8Array(), { algorithm: 'sha256' }), expected);
  }
});

test('streaming is identical at every SHA padding boundary and arbitrary chunk boundary', async () => {
  for (const algorithm of ['sha1', 'sha256']) {
    for (const length of [0, 1, 7, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1025, 65539]) {
      const data = Uint8Array.from({ length }, (_, index) => (index * 137 + index % 11) & 255);
      const hash = new IncrementalHash({ algorithm });
      for (let offset = 0; offset < length; offset += 13) hash.update(data.subarray(offset, offset + 13));
      assert.equal(hash.digest(), reference(algorithm, data), `${algorithm}: ${length}`);
      assert.equal(bytesToHex(hash.digest('bytes')), hash.digest());
      assert.equal(await hashBytes(data, { algorithm, subtle: null }), hash.digest());
      assert.throws(() => hash.update(new Uint8Array()), { code: 'Conflict' });
    }
  }
});

// The first five compression blocks of the two upstream SHAttered fixtures contain
// the collision. Source: git/sha1collisiondetection test/shattered-{1,2}.pdf.
// Upstream Git blobs: ba9aaa145ccd24ef760cf31c74d8f7ca1a2e47b0 and b621eeccd5c7edac9b7dcba35a8d5afd075e24f2.
const collisionPrefixes = [
  'JVBERi0xLjMKJeLjz9MKCgoxIDAgb2JqCjw8L1dpZHRoIDIgMCBSL0hlaWdodCAzIDAgUi9UeXBlIDQgMCBSL1N1YnR5cGUgNSAwIFIvRmlsdGVyIDYgMCBSL0NvbG9yU3BhY2UgNyAwIFIvTGVuZ3RoIDggMCBSL0JpdHNQZXJDb21wb25lbnQgOD4+CnN0cmVhbQr/2P/+ACRTSEEtMSBpcyBkZWFkISEhISGFL+wJIzl1nDmxocY8TJfh//4Bc0bckWa2fhGPApq2IbJWD/nKZ8yox/hbqEx5AwwrPeIY+G2zqQkB1d9FwU8m/t+z3DjpasIv571yjw5FvOBG0jxXD+sUE5i7VS71oKgr4zH+pIA3uLXXHw4zLt+TrDUA603cDezBqGR5DHgsdiFWYN0wl5HQa9CvP5jNpLxGKbEAAAAA',
  'JVBERi0xLjMKJeLjz9MKCgoxIDAgb2JqCjw8L1dpZHRoIDIgMCBSL0hlaWdodCAzIDAgUi9UeXBlIDQgMCBSL1N1YnR5cGUgNSAwIFIvRmlsdGVyIDYgMCBSL0NvbG9yU3BhY2UgNyAwIFIvTGVuZ3RoIDggMCBSL0JpdHNQZXJDb21wb25lbnQgOD4+CnN0cmVhbQr/2P/+ACRTSEEtMSBpcyBkZWFkISEhISGFL+wJIzl1nDmxocY8TJfh//4Bf0bck6a2fgE7ApqqHbJWC0XKZ9aIx/hLjEx5H+ArPfYU+G2xaQkBxWtFwVMK/t+3YDjpcnIv561yjw5JBOBGwjBXD+nUE5ir4S71vJQr4zVCpIAtmLXXDyozLsN/rDUU503cDyzBqHTNDHgwWiFWZGEwl4lga9C/P5jNqARGKaEAAAAA',
].map(value => new Uint8Array(Buffer.from(value, 'base64').subarray(0, 320)));

test('all SHA-1 entry points reject real SHAttered collision blocks across chunk boundaries', async () => {
  assert.notDeepEqual(collisionPrefixes[0], collisionPrefixes[1]);
  assert.equal(reference('sha1', collisionPrefixes[0]), reference('sha1', collisionPrefixes[1]));
  for (const data of collisionPrefixes) {
    await assert.rejects(hashBytes(data), { code: 'Unsafe', details: { algorithm: 'sha1', collision: true } });
    const hash = new IncrementalHash();
    assert.throws(() => {
      for (let index = 0; index < data.length; index++) hash.update(data.subarray(index, index + 1));
      hash.digest();
    }, { code: 'Unsafe' });
    assert.throws(() => hash.digest(), { code: 'Unsafe' });
    assert.equal(await hashBytes(data, { algorithm: 'sha256' }), reference('sha256', data));
  }
});

test('SHA-256 uses the supplied WebCrypto backend and only unsupported algorithms fall back', async () => {
  const data = encoder.encode('abc');
  let called = false;
  const subtle = { async digest(name, bytes) {
    assert.equal(name, 'SHA-256');
    called = true;
    return createHash('sha256').update(bytes).digest();
  } };
  assert.equal(await hashBytes(data, { algorithm: 'sha256', subtle }), reference('sha256', data));
  assert.equal(called, true);
  const missing = { async digest() { throw Object.assign(new Error('unavailable'), { name: 'NotSupportedError' }); } };
  assert.equal(await hashBytes(data, { algorithm: 'sha256', subtle: missing }), reference('sha256', data));
  await assert.rejects(hashBytes(data, { algorithm: 'sha256', subtle: { digest() { throw new Error('provider fault'); } } }),
    /provider fault/);
});

test('hashing rejects invalid data, algorithms, resource overflow and cancellation', async () => {
  assert.throws(() => new IncrementalHash({ algorithm: 'md5' }), { code: 'Unsupported' });
  assert.throws(() => new IncrementalHash({ maxBytes: 1 }).update(new Uint8Array(2)), { code: 'Limit' });
  await assert.rejects(hashBytes('abc'), TypeError);
  const signal = AbortSignal.abort();
  await assert.rejects(hashBytes(new Uint8Array(), { signal }), { code: 'Cancelled' });
  assert.throws(() => new IncrementalHash({ signal }).digest(), { code: 'Cancelled' });
  assert.equal(getObjectFormat('sha256').oidBytes, 32);
  assert.equal(validateObjectId('A'.repeat(40)), 'a'.repeat(40));
  assert.throws(() => validateObjectId('a'.repeat(40), 'sha256'), { code: 'Corrupt' });
  assert.throws(() => hexToBytes('bad'), { code: 'Corrupt' });
  assert.equal(bytesToHex(hexToBytes('0123AbFf')), '0123abff');
});
