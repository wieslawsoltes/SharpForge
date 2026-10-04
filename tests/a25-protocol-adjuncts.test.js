import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../packages/git/src/storage/memory-store.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { GitIndex } from '../packages/git/src/index-file.js';
import { MemoryWorktree } from '../packages/git/src/worktree.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';
import { hashBytes } from '../packages/git/src/hash.js';
import { LfsClient, parseLfsPointer, encodeLfsPointer } from '../packages/git/src/lfs.js';
import { cleanLfs, LfsUploadClient } from '../packages/git/src/lfs-push.js';
import { discoverSubmodules, initializeSubmodules, resolveSubmoduleUrl } from '../packages/git/src/submodules.js';
import { SparseCheckout, applySparseCheckout } from '../packages/git/src/sparse.js';

const encode = value => new TextEncoder().encode(value);
const decode = value => new TextDecoder().decode(value);

test('LFS pointer clean/download/cache states verify SHA-256 and reject altered bytes', async () => {
  const data = Uint8Array.from({ length: 2000 }, (_, index) => index % 251);
  const cache = new MemoryStore();
  const cleaned = await cleanLfs(data, { cache });
  const pointer = parseLfsPointer(cleaned.data);
  assert.equal(pointer.size, data.length);
  assert.equal(pointer.oid, await hashBytes(data, { algorithm: 'sha256' }));
  assert.deepEqual(encodeLfsPointer(pointer), cleaned.data);
  assert.equal(parseLfsPointer(encode('ordinary text')), null);
  let downloads = 0;
  const client = new LfsClient({ endpoint: 'https://lfs.test/r.git/info/lfs', cache: new MemoryStore(), transport: async request => {
    if (request.url.endsWith('/objects/batch')) return new Response(JSON.stringify({ objects: [
      { oid: pointer.oid, size: pointer.size, actions: { download: { href: 'https://storage.test/object', header: { Authorization: 'Bearer action-token' } } } }
    ] }));
    downloads++;
    assert.equal(request.credentialProvider, null);
    assert.equal(request.headers.get('authorization'), 'Bearer action-token');
    return new Response(data);
  } });
  const result = await client.download(pointer);
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.data, data);
  assert.equal((await client.download(pointer)).cached, true);
  assert.equal(downloads, 1);
  const missing = new LfsClient({ endpoint: 'https://lfs.test/r', transport: async () => new Response(JSON.stringify({ objects: [
    { oid: pointer.oid, size: pointer.size, error: { code: 404, message: 'fixture missing' } }
  ] })) });
  assert.equal((await missing.download(pointer)).state, 'missing');
  const tampered = new LfsClient({ endpoint: 'https://lfs.test/r', transport: async request => request.url.endsWith('/objects/batch') ?
    new Response(JSON.stringify({ objects: [{ oid: pointer.oid, size: pointer.size, actions: { download: { href: 'https://storage.test/x' } } }] })) :
    new Response(new Uint8Array(pointer.size)) });
  await assert.rejects(tampered.download(pointer), { code: 'Corrupt' });
});

test('LFS upload deduplicates outgoing pointers, uploads content then runs verify action', async () => {
  const cache = new MemoryStore();
  const { pointer } = await cleanLfs(encode('binary fixture'), { cache });
  const requests = [];
  const client = new LfsUploadClient({ endpoint: 'https://lfs.test/r', cache, transport: async request => {
    requests.push(request);
    if (request.url.endsWith('/objects/batch')) return new Response(JSON.stringify({ objects: [{ ...pointer, actions: {
      upload: { href: 'https://storage.test/upload' }, verify: { href: 'https://lfs.test/verify' }
    } }] }));
    return new Response(null, { status: 200 });
  } });
  const result = await client.uploadAll([pointer, pointer]);
  assert.equal(result.length, 1);
  assert.deepEqual(requests.map(request => request.method), ['POST', 'PUT', 'POST']);
  assert.equal(decode(requests[1].body), 'binary fixture');
  assert.equal(JSON.parse(decode(requests[2].body)).oid, pointer.oid);
});

test('LFS batch failures keep arbitrary server messages and action secrets out of diagnostics', async () => {
  const pointer = { oid: 'a'.repeat(64), size: 17 };
  const secret = 'Bearer action-secret https://storage.test/object?signature=temporary-secret';
  for (const code of [403, secret, 1e20]) {
    const transport = async () => new Response(JSON.stringify({ objects: [{ ...pointer, error: { code, message: secret } }] }));
    const client = new LfsUploadClient({ endpoint: 'https://lfs.test/r', transport });
    await assert.rejects(client.uploadAll([pointer]), error => {
      assert.equal(error.code, 'Network');
      assert.deepEqual(error.details, code === 403 ? { oid: pointer.oid, status: 403 } : { oid: pointer.oid });
      assert.equal(JSON.stringify(error.toJSON()).includes('temporary-secret'), false);
      return true;
    });
    const missing = await client.download(pointer);
    assert.equal(missing.state, 'missing');
    assert.equal(missing.message, 'LFS object is unavailable');
    assert.equal(JSON.stringify(missing).includes('action-secret'), false);
  }
});

test('submodule discovery validates paths/URLs and leaves untrusted modules untouched', async () => {
  const modules = '[submodule "library"]\n path = vendor/library\n url = ../library.git\n';
  const discovered = discoverSubmodules(modules, { parentUrl: 'https://git.test/team/root.git' });
  assert.equal(discovered[0].url, 'https://git.test/team/library.git');
  assert.equal(resolveSubmoduleUrl('../other.git', 'https://git.test/team/root.git'), 'https://git.test/team/other.git');
  assert.throws(() => discoverSubmodules(modules.replace('vendor/library', '../library'), { parentUrl: 'https://git.test/root.git' }), { code: 'Unsafe' });
  assert.throws(() => discoverSubmodules(modules.replace('../library.git', 'file:///etc/private'), { parentUrl: 'https://git.test/root.git' }), { code: 'Unsafe' });
  let effects = 0;
  const results = await initializeSubmodules({ submodules: discovered, isTrusted: async () => false,
    createRepository: async () => effects++, transportForOrigin: async () => effects++ });
  assert.equal(effects, 0);
  assert.equal(results[0].state, 'uninitialized');
});

test('trusted host descriptors reuse initialized submodules and preserve pinned detached HEAD semantics', async () => {
  const store = new MemoryStore();
  const odb = new ObjectDatabase({ store });
  const refs = new RefDatabase({ store });
  const tree = await odb.write('tree', encodeTree([]));
  const identity = { name: 'Fixture', email: 'fixture@example.test', timestamp: 1700000000, timezone: '+0000' };
  const original = await odb.write('commit', encodeCommit({ tree, parents: [], author: identity, committer: identity, message: 'original\n' }));
  const pinned = await odb.write('commit', encodeCommit({ tree, parents: [original], author: identity, committer: identity, message: 'pinned\n' }));
  await refs.update('refs/heads/main', original);
  await refs.setSymbolic('HEAD', 'refs/heads/main');
  let transfers = 0;
  const checkouts = [];
  const options = { submodules: [{ path: 'vendor/library', url: 'https://git.test/library.git', oid: pinned, update: 'checkout' }],
    isTrusted: async module => { assert.equal(module.oid, pinned); return true; },
    transportForOrigin: async () => async () => { transfers++; throw new Error('Unexpected transfer'); },
    createRepository: async () => ({ store, odb, refs, initialized: true }), checkout: async value => checkouts.push(value.oid) };
  assert.equal((await initializeSubmodules(options))[0].state, 'initialized');
  assert.equal(await refs.read('HEAD', { deref: false }), pinned);
  assert.equal(await refs.read('refs/heads/main'), original);
  assert.deepEqual(checkouts, [pinned]);
  assert.equal(transfers, 0);
  await refs.setSymbolic('HEAD', 'refs/heads/main');
  const refused = { ...options, checkout: async () => { throw new Error('Dirty worktree'); } };
  await assert.rejects(initializeSubmodules(refused), /Dirty worktree/);
  assert.equal(await refs.read('HEAD', { deref: false }), 'refs/heads/main');
  let restored = false;
  const concurrent = { ...options, checkout: async () => {
    await refs.update('refs/heads/concurrent', original);
    await refs.setSymbolic('HEAD', 'refs/heads/concurrent');
    return { rollback: async () => { restored = true; } };
  } };
  await assert.rejects(initializeSubmodules(concurrent), { code: 'Conflict' });
  assert.equal(restored, true);
  assert.equal(await refs.read('HEAD', { deref: false }), 'refs/heads/concurrent');
  await refs.update('HEAD', null, { deref: false });
  await assert.rejects(initializeSubmodules(options), { code: 'Conflict' });
  assert.equal(transfers, 0);
});

test('cone mode includes root/ancestor files and materializes only selected subtrees', async () => {
  const cone = new SparseCheckout(['src/editor', 'src/editor/widgets']);
  assert.deepEqual(cone.directories, ['src/editor']);
  for (const path of ['README.md', 'src/package.json', 'src/editor/main.js', 'src/editor/nested/item.js']) assert.equal(cone.includes(path), true);
  for (const path of ['src/runtime/main.js', 'tests/main.js']) assert.equal(cone.includes(path), false);
  assert.equal(SparseCheckout.fromPatterns(cone.toPatterns()).toPatterns(), cone.toPatterns());
  assert.throws(() => new SparseCheckout(['../escape']), { code: 'Unsafe' });
  const store = new MemoryStore();
  const odb = new ObjectDatabase({ store });
  const worktree = new MemoryWorktree();
  const entries = [];
  for (const path of ['README.md', 'src/package.json', 'src/editor/main.js', 'src/runtime/main.js']) {
    const data = encode(path);
    entries.push({ path, oid: await odb.write('blob', data), mode: 0o100644, stage: 0 });
    await worktree.write(path, data);
  }
  const index = new GitIndex({ entries });
  const result = await applySparseCheckout({ index, worktree, odb, directories: ['src/editor'], store });
  assert.equal(result.index.get('src/runtime/main.js').skipWorktree, true);
  assert.equal(await worktree.read('src/runtime/main.js'), null);
  const expanded = await applySparseCheckout({ index: result.index, worktree, odb, directories: [''], store });
  assert.equal(expanded.index.get('src/runtime/main.js').skipWorktree, false);
  assert.equal(decode((await worktree.read('src/runtime/main.js')).data), 'src/runtime/main.js');
});
