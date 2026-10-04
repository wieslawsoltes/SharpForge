import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { StatusContentCache } from '../packages/git/src/status-content-cache.js';
import { hashObject } from '../packages/git/src/hash.js';

for (const algorithm of ['sha1', 'sha256']) {
  test(`status content reuse checks every byte after a sampled-key collision (${algorithm})`, async () => {
    const cache = new StatusContentCache(algorithm);
    const first = new Uint8Array(128).fill(65);
    const second = first.slice();
    second[64] = 66;
    const original = first.slice();
    const firstOid = await cache.hash(first);
    const secondOid = await cache.hash(second);
    assert.notEqual(firstOid, secondOid);
    assert.equal(firstOid, await hashObject('blob', original, { algorithm }));
    assert.equal(secondOid, await hashObject('blob', second, { algorithm }));
    assert.equal(await cache.hash(original), firstOid);
    assert.equal(cache.hash(original), firstOid);
    first.fill(67);
    assert.equal(await cache.hash(original), firstOid);
    assert.equal(await cache.hash(first), await hashObject('blob', first, { algorithm }));
  });
}

test('single-scan content reuse stays within its entry and byte budgets', async () => {
  const cache = new StatusContentCache('sha1', { maxEntries: 2, maxBytes: 96, maxBlobBytes: 96 });
  for (let value = 0; value < 12; value++) {
    const bytes = new Uint8Array(64).fill(value);
    assert.equal(await cache.hash(bytes), await hashObject('blob', bytes));
    assert.ok(cache.byteLength <= 96);
    assert.ok(cache.entries.size <= 2);
  }
  const retainedBytes = cache.byteLength;
  const large = new Uint8Array(97);
  assert.equal(await cache.hash(large), await hashObject('blob', large));
  assert.equal(cache.byteLength, retainedBytes);
  assert.throws(() => new StatusContentCache('sha1', { maxBytes: Infinity }), { code: 'Limit' });
});

for (const algorithm of ['sha1', 'sha256']) {
  test(`a Buffer clean result cannot mutate retained hash bytes (${algorithm})`, async () => {
    const cache = new StatusContentCache(algorithm);
    const bytes = Buffer.alloc(128, 65);
    const original = await cache.hash(bytes);
    bytes[64] = 66;
    const changed = await cache.hash(bytes);
    assert.notEqual(changed, original);
    assert.equal(changed, await hashObject('blob', bytes, { algorithm }));
  });
}
