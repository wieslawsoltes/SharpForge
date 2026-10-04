import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  GitRepository, HttpGitTransport, cloneRepository, fetchRemote, listRemoteRefs, discoverRemote,
  parseRefspec, mapFetchRefs, prunableRefs, RemoteManager, deleteRemoteRef, pushRemote, validatePushPolicy
} from '../packages/git/src/index.js';
import { openNodeRepository } from '../packages/git/src/fs/node.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';
import {
  createFetchFixture, observedTransport, nativeRefs, sharpRefs, nativeObjectIds, assertNativeObjects, nativeDryRunRows, shortRef
} from './git-conformance/fetch-fixture.js';

async function withRemote(context, name, version, action) {
  const availability = await gitAvailability();
  if (!availability.available) { context.skip(availability.reason); return; }
  context.diagnostic(`Reference: ${availability.version}; native git http-backend forced to protocol ${version}`);
  const workspace = await fixtureWorkspace(`sharpforge-a25-${name}-`);
  let fixture;
  try {
    fixture = await createFetchFixture(workspace, { protocolVersion: version });
    return await action(workspace, fixture);
  } finally {
    try { await fixture?.server.close(); }
    finally { await workspace.dispose(); }
  }
}

function listedRows(refs) {
  return refs.flatMap(ref => [
    ...(ref.oid ? [`${ref.oid}\t${ref.name}`] : []),
    ...(ref.symref ? [`ref: ${ref.symref}\t${ref.name}`] : []),
    ...(ref.peeled ? [`${ref.peeled}\t${ref.name}^{}`] : [])
  ]).sort();
}

async function emptyClient(workspace, name) {
  const directory = join(workspace.root, name);
  await workspace.git(['init', '-q', '--initial-branch=main', directory]);
  return { directory, git: (args, options = {}) => workspace.git(args, { cwd: directory, ...options }) };
}

async function clonePair(workspace, fixture, name = 'native-clone') {
  const directory = join(workspace.root, name);
  await workspace.git(['clone', '-q', '--no-checkout', fixture.url, directory]);
  const native = { directory, git: (args, options = {}) => workspace.git(args, { cwd: directory, ...options }) };
  const repository = await new GitRepository().init();
  const observed = observedTransport(fixture.server.origin);
  try {
    await cloneRepository({ ...repository, transport: observed.transport, url: fixture.url, tags: 'all', noCheckout: true });
    return { repository, native, ...observed };
  } catch (error) { repository.dispose(); throw error; }
}

// SF-A25-T02.2 / T02.3: actual server advertisements and clone objects, not synthesized pkt-lines.
test('forced native HTTP v0, v1 and v2 list identical refs and clone identical objects and symbolic HEADs',
  { timeout: 180_000 }, async context => {
    let referenceIds;
    for (const version of [0, 1, 2]) await context.test(`protocol ${version}`, child => withRemote(child, 'protocol', version,
      async (workspace, fixture) => {
        const observed = observedTransport(fixture.server.origin);
        const remote = await listRemoteRefs({ transport: observed.transport, url: fixture.url });
        assert.equal(remote.version, version);
        const native = await fixture.git(['-c', `protocol.version=${version}`, 'ls-remote', '--symref', fixture.url]);
        assert.deepEqual(listedRows(remote.refs), native.text.split('\n').filter(Boolean).sort());
        assert.equal(remote.refs.find(ref => ref.name === 'HEAD').symref, 'refs/heads/main');
        const selected = await listRemoteRefs({ transport: observed.transport, url: fixture.url, prefixes: ['refs/heads/release/'] });
        assert.deepEqual(selected.refs.map(ref => ref.name), ['refs/heads/release/v1']);
        const pair = await clonePair(workspace, fixture);
        try {
          const ids = await assertNativeObjects(pair.repository, pair.native.git);
          if (referenceIds) assert.deepEqual(ids, referenceIds, 'v0/v1/v2 transfer the same canonical objects');
          referenceIds = ids;
          assert.deepEqual(await sharpRefs(pair.repository), await nativeRefs(pair.native.git));
          assert.equal(await pair.repository.refs.read('HEAD', { deref: false }), (await pair.native.git(['symbolic-ref', 'HEAD'])).text);
          assert.equal(await pair.repository.refs.read('refs/remotes/origin/HEAD', { deref: false }),
            (await pair.native.git(['symbolic-ref', 'refs/remotes/origin/HEAD'])).text);
          await assert.rejects(cloneRepository({ ...pair.repository, transport: pair.transport, url: fixture.url }), { code: 'Conflict' });
        } finally { pair.repository.dispose(); }
        const denied = new HttpGitTransport({ allowInsecureLocalhost: true });
        await assert.rejects(listRemoteRefs({ transport: denied, url: fixture.url }), { code: 'Auth' });
        const controller = new AbortController();
        controller.abort();
        const before = observed.requests.length;
        await assert.rejects(listRemoteRefs({ transport: observed.transport, url: fixture.url, signal: controller.signal }), { code: 'Cancelled' });
        assert.equal(observed.requests.length, before);
        if (version === 2) {
          await assert.rejects(listRemoteRefs({ transport: observed.transport, url: fixture.url, maxRefs: 1 }), { code: 'Limit' });
          await assert.rejects(listRemoteRefs({ transport: observed.transport, url: fixture.url, prefixes: ['refs/heads/\ncommand=fetch'] }),
            { code: 'Unsafe' });
        }
      }));
  });

// SF-A25-T02.4: transferred pack entries must equal native newly reachable objects, including no-op fetch.
test('incremental HTTP fetch transfers exactly the three objects introduced by one upstream commit',
  { timeout: 120_000 }, async context => {
    for (const version of [0, 2]) await context.test(`protocol ${version}`, child => withRemote(child, 'incremental', version,
      async (workspace, fixture) => {
        const pair = await clonePair(workspace, fixture);
        try {
          const before = new Set(await pair.repository.odb.list());
          await fixture.write('tracked.txt', 'one additional upstream version\n');
          const updated = await fixture.commit('incremental upstream', 10);
          const expected = await nativeObjectIds(fixture.git, [updated, '--not', fixture.main]);
          assert.equal(expected.length, 3, 'native commit, tree and changed blob');
          await fixture.git(['push', '-q', fixture.bare, 'refs/heads/main:refs/heads/main']);
          const result = await fetchRemote({ ...pair.repository, transport: pair.transport, url: fixture.url, tags: 'all' });
          assert.equal(result.fetched, expected.length);
          assert.equal(result.pack.count, expected.length);
          assert.deepEqual(result.pack.entries.map(entry => entry.oid).sort(), expected);
          assert.ok(result.pack.entries.every(entry => !before.has(entry.oid)), 'the pack contains no previously available objects');
          assert.ok(result.pack.bytes > 12);
          await pair.native.git(['fetch', '--quiet', '--tags', 'origin']);
          await assertNativeObjects(pair.repository, pair.native.git);
          assert.deepEqual(await sharpRefs(pair.repository), await nativeRefs(pair.native.git));
          const transfers = () => pair.requests.filter(request => request.method === 'POST' && request.body.includes('want ')).length;
          const count = transfers();
          const unchanged = await fetchRemote({ ...pair.repository, transport: pair.transport, url: fixture.url, tags: 'all' });
          assert.equal(unchanged.fetched, 0);
          assert.equal(unchanged.pack, null);
          assert.equal(transfers(), count, 'a no-op fetch does not request another upload pack');
        } finally { pair.repository.dispose(); }
      }));
  });

// SF-A25-T02.11: dry-run mappings are observed from native fetch, then both ref databases are compared.
test('fetch refspec mappings, HEAD, tags and negative exclusions match native dry-run and published refs',
  { timeout: 120_000 }, context => withRemote(context, 'refspec', 2, async (workspace, fixture) => {
    const cases = [
      ['+refs/heads/main:refs/remotes/fixture/main'],
      ['+refs/heads/*:refs/remotes/fixture/*', '^refs/heads/private/*'],
      ['+refs/heads/release/*:refs/custom/releases/*'],
      ['refs/tags/v1:refs/tags/copied'],
      ['refs/heads/main'],
      ['HEAD:refs/remotes/fixture/default']
    ];
    for (const [index, refspecs] of cases.entries()) {
      const native = await emptyClient(workspace, 'refspec-' + index);
      const repository = await new GitRepository().init();
      const { transport } = observedTransport(fixture.server.origin);
      try {
        const remote = await listRemoteRefs({ transport, url: fixture.url });
        const mappings = mapFetchRefs(remote.refs, refspecs);
        const args = ['fetch', '--no-tags', '--no-recurse-submodules', fixture.url, ...refspecs];
        const before = await nativeRefs(native.git);
        const dry = await native.git(['-c', 'fetch.output=full', ...args.slice(0, 1), '--dry-run', '--verbose', ...args.slice(1)]);
        assert.deepEqual(nativeDryRunRows(dry), mappings.map(mapping => `${shortRef(mapping.source)} -> ${shortRef(mapping.destination)}`).sort());
        assert.deepEqual(await nativeRefs(native.git), before, 'native dry-run cannot change references');
        await native.git(args);
        const result = await fetchRemote({ ...repository, transport, url: fixture.url, refspecs, tags: 'none', includeTag: false });
        assert.deepEqual(result.mappings, mappings);
        assert.deepEqual(await sharpRefs(repository), await nativeRefs(native.git), refspecs.join(' '));
      } finally { repository.dispose(); }
    }
    const invalid = [
      '+refs/heads/*:refs/remotes/fixture/main', '+^refs/heads/private/*', '^refs/heads/main:refs/remotes/fixture/main',
      'refs/heads/main:refs/remotes/fixture/name..bad', 'refs/heads/main:refs/remotes/fixture/main:extra',
      'refs/heads/*/*:refs/remotes/fixture/*'
    ];
    const native = await emptyClient(workspace, 'invalid-refspecs');
    for (const spec of invalid) {
      const result = await native.git(['fetch', '--dry-run', fixture.url, spec], { allowFailure: true });
      assert.notEqual(result.code, 0, spec);
      assert.throws(() => parseRefspec(spec), { code: 'Unsafe' });
      assert.deepEqual(await nativeRefs(native.git), []);
    }
  }));

test('native prune removes only absent mapped refs and an explicit guarded remote deletion matches push dry-run',
  { timeout: 120_000 }, context => withRemote(context, 'prune-delete', 2, async (workspace, fixture) => {
    await fixture.remoteGit(['update-ref', 'refs/heads/obsolete', fixture.base]);
    const pair = await clonePair(workspace, fixture);
    try {
      const extras = ['refs/remotes/fixture/stale', 'refs/remotes/fixture/private/retained', 'refs/remotes/unrelated/kept'];
      for (const name of extras) {
        await pair.native.git(['update-ref', name, fixture.base]);
        await pair.repository.refs.update(name, fixture.base);
      }
      const refspecs = ['+refs/heads/*:refs/remotes/fixture/*', '^refs/heads/private/*'];
      const remote = await listRemoteRefs({ transport: pair.transport, url: fixture.url });
      const pruned = prunableRefs(await pair.repository.refs.list(), remote.refs, refspecs).map(ref => ref.name);
      assert.deepEqual(pruned, ['refs/remotes/fixture/stale']);
      const args = ['fetch', '--prune', '--no-tags', fixture.url, ...refspecs];
      const before = await nativeRefs(pair.native.git);
      const dry = await pair.native.git(['-c', 'fetch.output=full', ...args.slice(0, 1), '--dry-run', '--verbose', ...args.slice(1)]);
      assert.deepEqual(nativeDryRunRows(dry).filter(row => row.startsWith('(none) -> ')), ['(none) -> fixture/stale']);
      assert.deepEqual(await nativeRefs(pair.native.git), before);
      await pair.native.git(args);
      const result = await fetchRemote({ ...pair.repository, transport: pair.transport, url: fixture.url, refspecs, prune: true, tags: 'none' });
      assert.deepEqual(result.updates.filter(update => update.oid === null).map(update => update.name), pruned);
      assert.deepEqual(await sharpRefs(pair.repository), await nativeRefs(pair.native.git));
      const deletion = ':refs/heads/obsolete';
      const parsed = parseRefspec(deletion, { push: true });
      const deletionDry = await pair.native.git(['push', '--dry-run', '--porcelain', fixture.url, deletion]);
      assert.deepEqual(deletionDry.text.split('\n').filter(line => line.startsWith('-\t')).map(line => line.split('\t')[1]),
        [`${parsed.source}:${parsed.destination}`]);
      assert.equal((await fixture.remoteGit(['rev-parse', parsed.destination])).text, fixture.base);
      await deleteRemoteRef({ ...pair.repository, transport: pair.transport, url: fixture.url, name: parsed.destination, expected: fixture.base });
      const missing = await fixture.remoteGit(['show-ref', '--verify', '--quiet', parsed.destination], { allowFailure: true });
      assert.equal(missing.code, 1);
      assert.equal(await pair.repository.refs.read('refs/remotes/origin/obsolete'), null);
    } finally { pair.repository.dispose(); }
  }));

// SF-A25-T06.3: a concurrent server update defeats both native and SharpForge stale leases without ref changes.
test('native and SharpForge stale force-with-lease reject concurrent upstream changes and unconfirmed force',
  { timeout: 90_000 }, context => withRemote(context, 'lease', 2, async (workspace, fixture) => {
    const pair = await clonePair(workspace, fixture);
    try {
      const stale = await discoverRemote({ transport: pair.transport, url: fixture.url, service: 'git-receive-pack' });
      await fixture.remoteGit(['update-ref', 'refs/heads/main', fixture.merged, fixture.main]);
      const before = await nativeRefs(fixture.remoteGit);
      const native = await pair.native.git(['push', '--force-with-lease=refs/heads/main:' + fixture.main,
        fixture.url, 'refs/remotes/origin/side:refs/heads/main'], { allowFailure: true });
      assert.notEqual(native.code, 0);
      const updates = [{ name: 'refs/heads/main', oldOid: fixture.main, newOid: fixture.side }];
      await assert.rejects(pushRemote({ ...pair.repository, transport: pair.transport, url: fixture.url, remote: stale, updates,
        leases: { 'refs/heads/main': fixture.main }, confirmation: 'fixture-consent', verifyConfirmation: async () => true }), { code: 'Conflict' });
      assert.deepEqual(await nativeRefs(fixture.remoteGit), before);
      assert.equal(await pair.repository.refs.read('refs/remotes/origin/main'), fixture.main);
      await assert.rejects(validatePushPolicy({ odb: pair.repository.odb, updates, remoteRefs: stale.refs, force: true }), { code: 'Auth' });
    } finally { pair.repository.dispose(); }
  }));

// SF-A25-T06.4: two native DAG sides, merges, ancestors, identity and disjoint roots.
test('ahead and behind exactly match native rev-list left-right counts with upstream configuration and cancellation',
  { timeout: 90_000 }, context => withRemote(context, 'ahead-behind', 2, async (_workspace, fixture) => {
    const repository = new GitRepository(await openNodeRepository({ directory: fixture.directory }));
    await repository.init();
    const manager = new RemoteManager({ ...repository, allowInsecureLocalhost: true });
    try {
      const cases = [
        ['refs/heads/main', 'refs/heads/main'], ['refs/heads/main', 'refs/tags/lightweight'],
        ['refs/tags/lightweight', 'refs/heads/main'], ['refs/heads/main', 'refs/heads/side'],
        ['refs/heads/side', 'refs/heads/main'], ['refs/heads/merged', 'refs/heads/main'],
        ['refs/heads/main', 'refs/heads/unrelated']
      ];
      for (const [left, right] of cases) {
        const counts = (await fixture.git(['rev-list', '--left-right', '--count', `${left}...${right}`])).text.split(/\s+/).map(Number);
        assert.equal(counts.length, 2);
        assert.deepEqual(await manager.aheadBehind(left, right), { ahead: counts[0], behind: counts[1] }, `${left}...${right}`);
      }
      await manager.add('origin', fixture.url);
      await repository.refs.update('refs/remotes/origin/side', fixture.side);
      await manager.setUpstream('main', 'origin', 'side');
      assert.equal((await fixture.git(['rev-parse', '--symbolic-full-name', 'main@{upstream}'])).text, 'refs/remotes/origin/side');
      const counts = (await fixture.git(['rev-list', '--left-right', '--count', 'main...main@{upstream}'])).text.split(/\s+/).map(Number);
      assert.deepEqual(await manager.aheadBehind('refs/heads/main', 'refs/remotes/origin/side'), { ahead: counts[0], behind: counts[1] });
      await assert.rejects(manager.aheadBehind('refs/heads/main', 'refs/heads/missing'), { code: 'NotFound' });
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(manager.aheadBehind('refs/heads/main', 'refs/heads/side', { signal: controller.signal }), { code: 'Cancelled' });
    } finally { repository.dispose(); }
  }));
