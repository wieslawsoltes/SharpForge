import test from 'node:test';
import assert from 'node:assert/strict';
import { GitIndex, decodeIndex, encodeIndex, decodeTreeCache, encodeTreeCache,
  decodeResolveUndo, encodeResolveUndo } from '../packages/git/src/index-file.js';
import { hashObject } from '../packages/git/src/hash.js';
import { GitError } from '../packages/git/src/errors.js';

const encoder = new TextEncoder();

for (const version of [2, 3, 4]) {
  test(`DIRC v${version} preserves entries, conflict stages and extension bytes`, async () => {
    const oid = await hashObject('blob', encoder.encode('content\n'));
    const entries = [];
    for (let index = 0; index < 40; index++) entries.push({ path: `directory/common-prefix-${String(index).padStart(3, '0')}.txt`,
      oid, mode: index % 2 ? 0o100755 : 0o100644, stage: 0,
      stat: { ctimeSeconds: 1700000000, ctimeNanoseconds: 12345, mtimeSeconds: 1700000001,
        mtimeNanoseconds: 45678, dev: 99, ino: index + 20, uid: 1000, gid: 1000, size: 8 },
      assumeValid: index === 2, intentToAdd: version !== 2 && index === 4, skipWorktree: version !== 2 && index === 5 });
    for (const stage of [1, 2, 3]) entries.push({ path: 'conflicted.txt', oid, mode: 0o100644, stage });
    const index = new GitIndex({ version, entries,
      extensions: [{ signature: 'TREE', data: encoder.encode('\0-1 0\n') }, { signature: 'REUC', data: new Uint8Array([1, 2, 3]) }] });
    const bytes = await encodeIndex(index);
    const decoded = await decodeIndex(bytes);
    assert.equal(decoded.version, version);
    assert.equal(decoded.entries.length, 43);
    assert.equal(decoded.get('conflicted.txt', 3).oid, oid);
    assert.deepEqual(await encodeIndex(decoded), bytes);
    assert.deepEqual(decoded.extensions, index.extensions);
    assert.equal(decoded.get('directory/common-prefix-005.txt').skipWorktree, version !== 2);
    const damaged = bytes.slice();
    damaged[20] ^= 1;
    await assert.rejects(decodeIndex(damaged), error => error instanceof GitError && error.code === 'Corrupt');
  });
}

test('index editing invalidates caches, upgrades extended flags and checks allocation bounds', async () => {
  const oid = await hashObject('blob', new Uint8Array());
  const index = new GitIndex({ extensions: [{ signature: 'TREE', data: encoder.encode('stale') }] });
  index.set({ path: 'a', oid, mode: 0o100644, intentToAdd: true });
  const decoded = await decodeIndex(await encodeIndex(index));
  assert.equal(decoded.version, 3);
  assert.equal(decoded.extensions.length, 0);
  assert.equal(decoded.get('a').intentToAdd, true);
  await assert.rejects(decodeIndex(new Uint8Array(100), { maxBytes: 10 }), { code: 'Limit' });
  await assert.rejects(decodeIndex(new Uint8Array(10)), { code: 'Corrupt' });
  assert.throws(() => new GitIndex({ version: 9 }), { code: 'Unsupported' });
});

test('SHA-256 index uses 32-byte object ids and trailer without changing DIRC semantics', async () => {
  const oid = await hashObject('blob', encoder.encode('sha256'), { algorithm: 'sha256' });
  const index = new GitIndex({ entries: [{ path: 'unicodé/文件.txt', oid, mode: 0o100644 }] });
  const encoded = await encodeIndex(index, { algorithm: 'sha256' });
  const parsed = await decodeIndex(encoded, { algorithm: 'sha256' });
  assert.equal(parsed.entries[0].oid, oid);
  assert.deepEqual(await encodeIndex(parsed, { algorithm: 'sha256' }), encoded);
});

test('TREE and REUC structured codecs preserve cached subtrees and all resolution stages', async () => {
  const oid = await hashObject('tree', new Uint8Array());
  const tree = { name: '', entryCount: -1, oid: null, children: [
    { name: 'nested', entryCount: 1, oid, children: [] }
  ] };
  const bytes = encodeTreeCache(tree);
  assert.deepEqual(encodeTreeCache(decodeTreeCache(bytes)), bytes);
  const resolutions = [{ path: 'conflict.txt', stages: [null, { mode: 0o100644, oid }, { mode: 0o100755, oid }, null] }];
  const encoded = encodeResolveUndo(resolutions);
  assert.deepEqual(decodeResolveUndo(encoded), resolutions);
  assert.throws(() => decodeResolveUndo(encoded.subarray(0, encoded.length - 1)), { code: 'Corrupt' });
});
