import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GitRepository, PromisorDatabase, createGitService, createPackReader, readPackIndex, encodeIndex, PktLineDecoder, PacketKind
} from '@sharpforge/git';
import { initNodeRepository } from '@sharpforge/git/node';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';
import { createFetchFixture, observedTransport, nativeRefs, sharpRefs, nativeObjectIds } from './git-conformance/fetch-fixture.js';

const decode = bytes => new TextDecoder().decode(bytes);

function inspectionGit(workspace, directory) {
  return (args, options = {}) => workspace.git(args, { cwd: directory, ...options,
    env: { ...options.env, GIT_NO_LAZY_FETCH: '1' } });
}

/** Enumerate physically present objects; never traverse missing promised objects or hydrate them for comparison. */
async function storedObjects(git) {
  const { stdout } = await git(['cat-file', '--batch-all-objects', '--batch']);
  const objects = new Map();
  let cursor = 0;
  while (cursor < stdout.length) {
    const end = stdout.indexOf(10, cursor);
    assert.ok(end >= cursor, 'Native stored-object header is present');
    const [oid, type, length] = stdout.subarray(cursor, end).toString().split(' ');
    const size = Number(length);
    assert.match(oid, /^[0-9a-f]{40}$/u);
    assert.ok(['commit', 'tree', 'blob', 'tag'].includes(type));
    assert.ok(Number.isSafeInteger(size) && size >= 0 && end + size + 1 < stdout.length);
    assert.equal(stdout[end + size + 1], 10);
    assert.equal(objects.has(oid), false);
    objects.set(oid, { oid, type, data: stdout.subarray(end + 1, end + size + 1) });
    cursor = end + size + 2;
  }
  return objects;
}

async function compareStoredObjects(repo, nativeGit, expected, localArtifacts = new Map()) {
  const native = await storedObjects(nativeGit);
  const ids = [...expected.keys()].sort();
  assert.deepEqual([...native.keys()].sort(), ids, 'Native retained objects equal the requested closure');
  assert.deepEqual((await repo.odb.list()).sort(), [...ids, ...localArtifacts.keys()].sort(),
    'SharpForge retains exactly the transferred objects and identified local recovery objects');
  for (const oid of ids) {
    const actual = await repo.odb.readLocal(oid);
    const reference = expected.get(oid);
    assert.equal(actual.type, reference.type, `${oid}: SharpForge object type`);
    assert.deepEqual(Buffer.from(actual.data), reference.data, `${oid}: SharpForge canonical bytes`);
    assert.equal(native.get(oid).type, reference.type, `${oid}: native object type`);
    assert.deepEqual(native.get(oid).data, reference.data, `${oid}: native canonical bytes`);
  }
  for (const [oid, reference] of localArtifacts) {
    const object = await repo.odb.readLocal(oid);
    assert.equal(object.type, reference.type, `${oid}: local recovery object type`);
    assert.deepEqual(Buffer.from(object.data), reference.data, `${oid}: exact local recovery bytes`);
  }
  return native;
}

/** Native partial clone keeps packs; compare their indexes and contents without requiring that storage layout locally. */
async function verifyNativePacks(directory, git, expected) {
  const packDirectory = join(directory, '.git', 'objects', 'pack');
  const names = (await readdir(packDirectory)).filter(name => name.endsWith('.idx')).sort();
  assert.ok(names.length > 0, 'The native partial clone retains a pack index');
  const indexed = new Set();
  for (const name of names) {
    const path = join(packDirectory, name);
    const native = await git(['verify-pack', '-v', path]);
    const verified = native.text.split('\n').flatMap(line => {
      const match = /^([0-9a-f]{40}) (?:commit|tree|blob|tag) /u.exec(line);
      return match ? [match[1]] : [];
    }).sort();
    const index = await readPackIndex(await readFile(path));
    const ids = index.entries().map(entry => entry.oid).sort();
    assert.deepEqual(ids, verified, `${name}: native verify-pack and IDX2 parser agree`);
    assert.equal(name, `pack-${index.packChecksum}.idx`);
    const reader = await createPackReader({ pack: await readFile(path.replace(/\.idx$/u, '.pack')), index });
    for (const oid of ids) {
      indexed.add(oid);
      const object = await reader.read(oid);
      assert.equal(object.type, expected.get(oid)?.type);
      assert.deepEqual(Buffer.from(object.data), expected.get(oid)?.data, `${name}: canonical pack bytes`);
    }
  }
  assert.deepEqual([...indexed].sort(), [...expected.keys()].sort(), 'Native retained pack indexes cover every local object');
  return names.length;
}

function fetchCommands(requests) {
  return requests.filter(request => request.body.includes('command=fetch')).map(request => {
    const decoder = new PktLineDecoder();
    const packets = decoder.push(new TextEncoder().encode(request.body));
    decoder.finish();
    return packets.filter(packet => packet.kind === PacketKind.Data).map(packet => decode(packet.data).trimEnd());
  });
}

async function compareMetadata(repo, nativeGit, url) {
  assert.deepEqual(await sharpRefs(repo), await nativeRefs(nativeGit));
  assert.equal(await repo.refs.read('HEAD'), (await nativeGit(['rev-parse', 'HEAD'])).text);
  assert.equal(await repo.refs.read('HEAD', { deref: false }), (await nativeGit(['symbolic-ref', 'HEAD'])).text);
  for (const key of ['remote.origin.url', 'remote.origin.fetch', 'branch.main.remote', 'branch.main.merge']) {
    assert.equal(repo.config.get(key), (await nativeGit(['config', '--get', key])).text, key);
  }
  const description = JSON.parse(decode(await repo.store.get('sharpforge/promisor')));
  assert.deepEqual(description, { url, filter: 'blob:none', algorithm: 'sha1' });
  assert.equal((await nativeGit(['config', '--bool', '--get', 'remote.origin.promisor'])).text, 'true');
  assert.equal((await nativeGit(['config', '--get', 'remote.origin.partialclonefilter'])).text, description.filter);
}

async function createSharpClient(directory, fixture) {
  const descriptor = await initNodeRepository({ directory });
  const repo = new GitRepository(descriptor);
  let service;
  try {
    await repo.init();
    const observed = observedTransport(fixture.server.origin);
    service = createGitService({ allowInsecureLocalhost: true, localOrigins: [fixture.server.origin], fetch: observed.transport.fetch });
    service.attach('default', repo, { dispose: async () => {
      try { await repo.dispose(); }
      finally { await descriptor.store.close(); }
    } });
    return { service, repo, requests: observed.requests };
  } catch (error) {
    await service?.dispose();
    await repo.dispose();
    await descriptor.store.close();
    throw error;
  }
}

async function checkoutEntries(git) {
  const result = await git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']);
  return result.stdout.toString().split('\0').filter(Boolean).map(row => {
    const match = /^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$/u.exec(row);
    assert.ok(match, 'The fixture contains ordinary blob entries');
    return { mode: match[1], oid: match[2], path: match[3] };
  });
}

async function assertHydration({ fixture, client, native, sharp, workspace, source, metadata, context }) {
  const { repo, service, requests } = client;
  const nativeGit = inspectionGit(workspace, native);
  const entries = await checkoutEntries(nativeGit);
  const wanted = [...new Set(entries.map(entry => entry.oid))].sort();
  assert.ok(wanted.length < entries.length, 'Two paths share a promised blob and must not request it twice');
  const metadataKeys = ['FETCH_HEAD', 'config', 'sharpforge/promisor'];
  const before = new Map();
  for (const key of metadataKeys) before.set(key, await repo.store.get(key));
  // Checkout retains the old index as a rollback blob; this is local metadata, not downloaded history.
  const recoveryIndex = await encodeIndex(repo.index, { algorithm: repo.algorithm });
  const recoveryOid = (await nativeGit(['hash-object', '--stdin'], { input: recoveryIndex })).text;
  assert.equal(await repo.odb.has(recoveryOid), false);
  const localArtifacts = new Map([[recoveryOid, { type: 'blob', data: Buffer.from(recoveryIndex) }]]);
  const cancelled = new AbortController();
  cancelled.abort();
  const requestCount = requests.length;
  await assert.rejects(service.request('checkout', { revision: 'main', force: true }, { signal: cancelled.signal }), { code: 'Cancelled' });
  assert.equal(requests.length, requestCount);
  assert.deepEqual(await repo.worktree.list(), []);

  // This command intentionally materializes the native checkout; all reference inspections disable lazy fetch.
  await workspace.git(['-c', 'protocol.version=2', 'checkout', '-q', '--force', 'main'], { cwd: native });
  await service.request('checkout', { revision: 'main', force: true }, { signal: context.signal });
  const commands = fetchCommands(requests);
  assert.equal(commands.length, 2, 'One metadata fetch plus one batched checkout hydration');
  const hydration = commands[1];
  assert.deepEqual(hydration.filter(line => line.startsWith('want ')).map(line => line.slice(5)).sort(), wanted);
  assert.equal(hydration.some(line => line.startsWith('filter ') || line.startsWith('have ')), false);
  for (const key of metadataKeys) assert.deepEqual(await repo.store.get(key), before.get(key), `${key}: object hydration preserves metadata`);
  const expected = new Map(metadata);
  for (const oid of wanted) expected.set(oid, source.get(oid));
  const inspectionCount = requests.length;
  const retained = await compareStoredObjects(repo, nativeGit, expected, localArtifacts);
  const packCount = await verifyNativePacks(native, nativeGit, retained);
  const sharpGit = inspectionGit(workspace, sharp);
  for (const args of [['ls-files', '--stage', '-z'], ['status', '--porcelain=v1', '-z']]) {
    assert.deepEqual((await sharpGit(args)).stdout, (await nativeGit(args)).stdout, `Native CLI agrees on ${args[0]}`);
  }
  assert.deepEqual(await repo.status(), []);
  for (const entry of entries) {
    assert.deepEqual((await repo.worktree.read(entry.path)).data, new Uint8Array(await readFile(join(native, entry.path))), entry.path);
  }
  await compareMetadata(repo, nativeGit, fixture.url);
  assert.equal(requests.length, inspectionCount, 'Local object, pack, status and metadata inspections never hydrate');
  return { checkoutPaths: entries.length, hydratedBlobs: wanted.length, retainedObjects: retained.size, nativePacks: packCount,
    localRecoveryObjects: localArtifacts.size, hydrationRequests: commands.length - 1, historicalBlobsStillMissing: source.size - retained.size };
}

// SF-A25-T02.9 / #2091: real git http-backend responses and real native .git files, with no scripted pack responses.
test('native blob:none clone and batched checkout retain identical canonical objects without fetching historical blobs',
  { timeout: 120_000 }, async context => {
    const availability = await gitAvailability();
    if (!availability.available) { context.skip(availability.reason); return; }
    const workspace = await fixtureWorkspace('sharpforge-partial-native-');
    let fixture;
    let client;
    try {
      fixture = await createFetchFixture(workspace, { protocolVersion: 2 });
      await fixture.remoteGit(['config', 'uploadpack.allowFilter', 'true']);
      await fixture.remoteGit(['config', 'uploadpack.allowAnySHA1InWant', 'true']);
      await fixture.write('nested/copy.bin', Uint8Array.of(0, 255, 7, 128, 0));
      await fixture.commit('duplicate blob at a second checkout path', 10);
      await fixture.git(['push', '-q', fixture.bare, 'refs/heads/main:refs/heads/main']);
      const source = await storedObjects(inspectionGit(workspace, fixture.bare));
      const reachable = new Set(await nativeObjectIds(fixture.remoteGit));
      for (const oid of source.keys()) if (!reachable.has(oid)) source.delete(oid);
      const metadata = new Map([...source].filter(([, object]) => object.type !== 'blob'));
      const native = join(workspace.root, 'native');
      const sharp = join(workspace.root, 'sharp');
      await workspace.git(['-c', 'protocol.version=2', 'clone', '-q', '--filter=blob:none', '--no-checkout', fixture.url, native]);
      client = await createSharpClient(sharp, fixture);
      const cloned = await client.service.request('clone', { url: fixture.url, filter: 'blob:none', noCheckout: true, tags: 'all' },
        { signal: context.signal });
      assert.ok(client.repo.odb instanceof PromisorDatabase);
      assert.equal(cloned.pack.count, metadata.size);
      assert.deepEqual(await client.repo.worktree.list(), []);
      const nativeGit = inspectionGit(workspace, native);
      assert.equal((await nativeGit(['ls-files', '-z'])).stdout.length, 0);
      const retained = await compareStoredObjects(client.repo, nativeGit, metadata);
      const initialPacks = await verifyNativePacks(native, nativeGit, retained);
      await compareMetadata(client.repo, nativeGit, fixture.url);
      const commands = fetchCommands(client.requests);
      assert.equal(commands.length, 1);
      assert.ok(commands[0].includes('filter blob:none'));
      const result = await assertHydration({ fixture, client, native, sharp, workspace, source, metadata, context });
      assert.ok(result.historicalBlobsStillMissing > 0, 'Unrequested historical blobs remain absent');
      context.diagnostic(`SHARPFORGE_GIT_PARTIAL ${JSON.stringify({ reference: availability.version, protocol: 2,
        algorithm: 'sha1', filter: 'blob:none', metadataObjects: metadata.size, initialNativePacks: initialPacks, ...result })}`);
    } finally {
      try { await client?.service.dispose(); }
      finally {
        try { await fixture?.server.close(); }
        finally { await workspace.dispose(); }
      }
    }
  });
