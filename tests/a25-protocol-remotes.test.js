import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../packages/git/src/storage/memory-store.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { GitConfig } from '../packages/git/src/config.js';
import { encodeCommit, encodeTree } from '../packages/git/src/objects.js';
import { MemoryWorktree } from '../packages/git/src/worktree.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { parseRefspec, mapFetchRefs, prunableRefs } from '../packages/git/src/refspec.js';
import { RemoteManager } from '../packages/git/src/remotes.js';
import { validatePushPolicy } from '../packages/git/src/push-policy.js';
import { buildPushCommands, parsePushStatus, sendPack } from '../packages/git/src/protocol/push.js';
import { encodePackets, encodePktLine } from '../packages/git/src/protocol/pktline.js';
import { concatBytes } from '../packages/git/src/protocol/bytes.js';
import { cloneRepository, recoverClone, CLONE_JOURNAL_KEY, CLONE_CHECKPOINTS } from '../packages/git/src/clone.js';

const oid = 'a'.repeat(40);
const other = 'b'.repeat(40);
const identity = { name: 'Fixture', email: 'fixture@example.test', timestamp: 1000, timezone: '+0000' };

async function repository() {
  const store = new MemoryStore();
  const odb = new ObjectDatabase({ store });
  const refs = new RefDatabase({ store });
  const config = new GitConfig({ store });
  await config.load();
  return { store, odb, refs, config };
}

test('refspec wildcard/exclusion/prune only affects mapped tracking references', () => {
  const specs = ['+refs/heads/*:refs/remotes/origin/*', '^refs/heads/private/*'];
  const remote = [{ name: 'refs/heads/main', oid }, { name: 'refs/heads/private/key', oid: other }];
  assert.deepEqual(mapFetchRefs(remote, specs), [{ source: 'refs/heads/main', destination: 'refs/remotes/origin/main', oid, force: true }]);
  const local = [{ name: 'refs/remotes/origin/stale', oid }, { name: 'refs/remotes/origin/private/key', oid },
    { name: 'refs/heads/local', oid }, { name: 'refs/remotes/other/stale', oid }];
  assert.deepEqual(prunableRefs(local, remote, specs).map(ref => ref.name), ['refs/remotes/origin/stale']);
  assert.throws(() => parseRefspec('+refs/heads/*:refs/remotes/origin/main'), { code: 'Unsafe' });
  assert.throws(() => parseRefspec('^refs/heads/a:refs/heads/b'), { code: 'Unsafe' });
  assert.equal(parseRefspec(':refs/heads/main', { push: true }).source, '');
});

test('remote add/rename/upstream/remove atomically maintain config and tracking refs', async () => {
  const repo = await repository();
  const manager = new RemoteManager(repo);
  await manager.add('origin', 'https://git.test/r.git');
  await repo.refs.update('refs/remotes/origin/main', oid);
  await repo.refs.setSymbolic('refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  await manager.setUpstream('main', 'origin', 'main');
  await manager.rename('origin', 'upstream');
  assert.equal(repo.config.get('remote.upstream.url'), 'https://git.test/r.git');
  assert.equal(repo.config.get('branch.main.remote'), 'upstream');
  assert.equal(await repo.refs.read('refs/remotes/upstream/main'), oid);
  assert.equal(await repo.refs.read('refs/remotes/upstream/HEAD', { deref: false }), 'refs/remotes/upstream/main');
  assert.equal(await repo.refs.read('refs/remotes/origin/main'), null);
  await manager.remove('upstream');
  assert.deepEqual(manager.list(), []);
  assert.equal(repo.config.has('branch.main.merge'), false);
  assert.deepEqual(await repo.refs.list('refs/remotes/'), []);
});

test('non-fast-forward and lease protection require matching IDs and verified force confirmation', async () => {
  const repo = await repository();
  const tree = await repo.odb.write('tree', new Uint8Array());
  const commit = async (parents, message) => repo.odb.write('commit', encodeCommit({ tree, parents, author: identity, committer: identity, message }));
  const base = await commit([], 'base');
  const left = await commit([base], 'left');
  const right = await commit([base], 'right');
  const options = { odb: repo.odb, remoteRefs: [{ name: 'refs/heads/main', oid: left }], updates: [{ name: 'refs/heads/main', newOid: right }] };
  await assert.rejects(validatePushPolicy(options), { code: 'Conflict' });
  await assert.rejects(validatePushPolicy({ ...options, leases: { 'refs/heads/main': base }, confirmation: 'fixture' }), { code: 'Conflict' });
  await assert.rejects(validatePushPolicy({ ...options, force: true }), { code: 'Auth' });
  const allowed = await validatePushPolicy({ ...options, leases: { 'refs/heads/main': left }, confirmation: 'fixture', verifyConfirmation: async () => true });
  assert.equal(allowed[0].oldOid, left);
  assert.equal(allowed[0].newOid, right);
});

test('receive-pack status-v2, nested sideband and protected branch messages retain exact per-ref outcome', async () => {
  const remote = { capabilities: new Map(['report-status-v2', 'atomic', 'side-band-64k', 'delete-refs', 'ofs-delta']
    .map(name => [name, ''])) };
  const commands = buildPushCommands({ updates: [{ name: 'refs/heads/main', oldOid: oid, newOid: other }], remote });
  assert.equal(commands.sideband, true);
  const inner = encodePackets(['unpack ok\n', 'ok refs/heads/main\n', `option old-oid ${oid}\n`]);
  const outer = concatBytes([encodePktLine(concatBytes([Uint8Array.of(1), inner])), encodePktLine({ kind: 'flush' })]);
  const parsed = await parsePushStatus(outer, { sideband: true });
  assert.deepEqual(parsed.refs[0].options, [`old-oid ${oid}`]);
  const rejected = encodePackets(['unpack ok\n', 'ng refs/heads/main protected branch rule 42\n']);
  await assert.rejects(sendPack({ transport: async () => ({ status: 200, body: rejected }), url: 'https://git.test/r.git',
    updates: [{ name: 'refs/heads/main', oldOid: oid, newOid: other }], pack: new Uint8Array(),
    remote: { capabilities: new Map([['report-status-v2', ''], ['atomic', '']]) } }), error => {
    assert.equal(error.code, 'Conflict');
    assert.equal(error.details.rejected[0].message, 'protected branch rule 42');
    return true;
  });
});

test('clone recovery transaction restores only a recorded empty destination baseline', async () => {
  const repo = await repository();
  const baseline = new TextEncoder().encode('ref: refs/heads/main\n');
  await repo.store.set('HEAD', baseline);
  await repo.store.set('objects/aa/bb', Uint8Array.of(1, 2, 3));
  await repo.store.set(CLONE_JOURNAL_KEY, new TextEncoder().encode(JSON.stringify({
    version: 1, url: 'https://git.test/r.git', algorithm: 'sha1', phase: 'fetching', baseline: [['HEAD', [...baseline]]]
  })));
  const result = await recoverClone(repo);
  assert.equal(result.recovered, true);
  assert.deepEqual(await repo.store.list(''), ['HEAD']);
  assert.deepEqual(await repo.store.get('HEAD'), baseline);
});

async function cloneFixture() {
  const source = await repository();
  const blob = await source.odb.write('blob', new TextEncoder().encode('fixture file\n'));
  const tree = await source.odb.write('tree', encodeTree([{ name: 'README.md', mode: 0o100644, oid: blob }]));
  const tip = await source.odb.write('commit', encodeCommit({ tree, parents: [], author: identity, committer: identity, message: 'fixture' }));
  const objects = await Promise.all((await source.odb.list()).map(key => source.odb.read(key)));
  const { pack } = await writePack(objects);
  const transport = async request => {
    if (request.method === 'GET') return new Response(encodePackets(['version 2\n', 'ls-refs=unborn\n', 'fetch=shallow\n', 'object-format=sha1\n']));
    if (new TextDecoder().decode(request.body).includes('command=ls-refs')) {
      return new Response(encodePackets([`${tip} HEAD symref-target:refs/heads/main\n`, `${tip} refs/heads/main\n`]));
    }
    return new Response(concatBytes([encodePktLine('packfile\n'), encodePktLine(concatBytes([Uint8Array.of(1), pack])),
      encodePktLine({ kind: 'flush' })]));
  };
  return { tip, transport, url: 'https://git.test/fixture.git' };
}

test('all ten clone checkpoints cleanly recover and verified resume needs no network transfer', async () => {
  const fixture = await cloneFixture();
  for (const phase of CLONE_CHECKPOINTS) {
    const repo = await repository();
    const worktree = new MemoryWorktree();
    await assert.rejects(cloneRepository({ ...repo, ...fixture, worktree,
      checkout: async () => worktree.write('README.md', new TextEncoder().encode('checked out')),
      onCheckpoint: actual => { if (actual === phase) throw new Error(`injected ${phase}`); } }));
    assert.equal((await repo.odb.list()).length, 0, phase);
    assert.equal((await repo.refs.list()).length, 0, phase);
    assert.equal((await worktree.list()).length, 0, phase);
    assert.equal(await repo.store.get(CLONE_JOURNAL_KEY), undefined, phase);
  }
  const repo = await repository();
  await assert.rejects(cloneRepository({ ...repo, ...fixture, retainInterrupted: true,
    onCheckpoint: phase => { if (phase === 'verified') throw new Error('simulated worker interruption'); } }));
  const result = await cloneRepository({ ...repo, ...fixture, transport: async () => { throw new Error('resume contacted the network'); } });
  assert.equal(result.resumed, true);
  assert.equal(await repo.refs.read('HEAD'), fixture.tip);
  assert.equal(await repo.refs.read('refs/remotes/origin/HEAD', { deref: false }), 'refs/remotes/origin/main');
  assert.equal(await repo.refs.read('refs/remotes/origin/HEAD'), fixture.tip);
  assert.equal(await repo.store.get(CLONE_JOURNAL_KEY), undefined);
});
