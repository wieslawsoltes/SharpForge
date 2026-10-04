import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initNodeRepository, openNodeRepository } from '../packages/git/src/fs/node.js';
import { NodeDirectoryIO } from '../packages/git/src/fs/node-io.js';
import { GitRepository } from '../packages/git/src/repository.js';
import { fixtureWorkspace, gitAvailability } from './git-conformance/native.js';

const identity = { name: 'Fixture Committer', email: 'committer@example.test', timestamp: 1700000000, timezone: '+0000' };
const encode = value => new TextEncoder().encode(value);
const oid = '1'.repeat(40);

async function repository(t, branch = 'feature') {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-git-namespace-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const descriptor = await initNodeRepository({ directory, defaultBranch: branch });
  t.after(() => descriptor.odb.close());
  await descriptor.refs.update('HEAD', oid, { expected: null, identity, message: 'commit: fixture' });
  return descriptor;
}

async function snapshot(store) {
  const result = [];
  for (const key of await store.list()) result.push([key, await store.get(key)]);
  return result;
}

test('Node ref rename converts file and directory namespaces while moving the reflog and symbolic HEAD', async t => {
  const { refs, store } = await repository(t);
  const original = await refs.reflog('refs/heads/feature');
  for (const [before, after] of [['feature', 'feature/sub/deep'], ['feature/sub/deep', 'feature']]) {
    const source = `refs/heads/${before}`;
    const target = `refs/heads/${after}`;
    await refs.rename(source, target, { expected: oid, expectedTarget: null, identity, message: `rename ${before} to ${after}` });
    assert.equal(await refs.read(source), null);
    assert.equal(await refs.read(target), oid);
    assert.equal(await refs.read('HEAD', { deref: false }), target);
    assert.deepEqual((await refs.reflog('HEAD')).slice(-2).map(entry => [entry.oldOid, entry.newOid]),
      [[oid, '0'.repeat(40)], ['0'.repeat(40), oid]]);
    assert.equal(await store.get(`logs/${source}`), undefined);
    assert.deepEqual((await refs.reflog(target)).slice(0, original.length), original);
  }
  assert.equal((await refs.reflog('refs/heads/feature')).length, original.length + 2);
  assert.equal((await store.io.list()).some(key => key.includes('sharpforge-node-transaction') || key.endsWith('.lock')), false);
});

test('Node namespace preparation preserves foreign Git locks and rejects stale CAS or unmodified descendant files', async t => {
  const { refs, store, gitDirectory } = await repository(t);
  const before = await snapshot(store);
  await assert.rejects(refs.rename('refs/heads/feature', 'refs/heads/feature/sub', { expected: '2'.repeat(40), identity }), { code: 'Conflict' });
  await writeFile(join(gitDirectory, 'refs/heads/feature.lock'), 'external writer');
  await assert.rejects(refs.rename('refs/heads/feature', 'refs/heads/feature/sub', { expected: oid, identity }), { code: 'Conflict' });
  assert.equal(await readFile(join(gitDirectory, 'refs/heads/feature.lock'), 'utf8'), 'external writer');
  await rm(join(gitDirectory, 'refs/heads/feature.lock'));
  assert.deepEqual(await snapshot(store), before);
  await store.set('other/retained', encode('must remain'));
  await store.set('other/removed', encode('original'));
  const nested = await snapshot(store);
  await assert.rejects(store.transaction(async tx => {
    await tx.delete('other/removed');
    await tx.set('other', encode('replacement'));
  }), { code: 'Conflict' });
  assert.deepEqual(await snapshot(store), nested);
});

class FailAfterPublication extends NodeDirectoryIO {
  constructor(directory, key) {
    super({ directory });
    this.failureKey = key;
    this.failed = false;
  }

  async publish(key) {
    await super.publish(key);
    if (key === this.failureKey && !this.failed) {
      this.failed = true;
      throw Object.assign(new Error('Injected filesystem quota failure after publication'), { code: 'ENOSPC' });
    }
  }
}

for (const [source, target] of [['feature', 'feature/sub'], ['feature/sub', 'feature']]) {
  for (const failureKey of ['HEAD', `refs/heads/${target}`, `logs/refs/heads/${target}`]) {
    test(`Node prefix rename restores every original file after publishing ${failureKey} (${source} to ${target})`, async t => {
      const { refs, store, gitDirectory } = await repository(t, source);
      const before = await snapshot(store);
      store.io = new FailAfterPublication(gitDirectory, failureKey);
      await assert.rejects(refs.rename(`refs/heads/${source}`, `refs/heads/${target}`, { identity, expected: oid }), { code: 'Quota' });
      assert.equal(store.io.failed, true, 'failure must occur after an actual native rename');
      assert.deepEqual(await snapshot(store), before);
      assert.equal((await store.io.list()).some(key => key.includes('sharpforge-node-transaction') || key.endsWith('.lock')), false);
    });
  }
}

test('rollback rechecks a formerly obstructed path after locking and preserves a newly published foreign value', async t => {
  const { refs, store, gitDirectory } = await repository(t, 'feature/sub');
  const foreign = `${'2'.repeat(40)}\n`;
  class ConcurrentWriterIO extends FailAfterPublication {
    async delete(key) {
      await super.delete(key);
      if (this.failed && key === 'refs/heads/feature') {
        await mkdir(join(this.directory, 'refs/heads/feature'), { recursive: true });
        await writeFile(join(this.directory, 'refs/heads/feature/sub'), foreign);
      }
    }
  }
  store.io = new ConcurrentWriterIO(gitDirectory, 'refs/heads/feature');
  await assert.rejects(refs.rename('refs/heads/feature/sub', 'refs/heads/feature', { identity, expected: oid }), { code: 'Conflict' });
  assert.equal(await readFile(join(gitDirectory, 'refs/heads/feature/sub'), 'utf8'), foreign);
  assert.equal(JSON.parse(await readFile(join(gitDirectory, '.sharpforge-node-transaction/manifest'), 'utf8')).state, 'revert');
});

for (const algorithm of ['sha1', 'sha256']) {
  for (const packed of [false, true]) {
    test(`Node ${algorithm} prefix branch renames match native refs, HEAD and reflogs (${packed ? 'packed' : 'loose'})`, async t => {
      const availability = await gitAvailability();
      if (!availability.available) { t.skip(availability.reason); return; }
      t.diagnostic(availability.version);
      const workspace = await fixtureWorkspace('sharpforge-git-prefix-native-');
      t.after(() => workspace.dispose());
      const native = join(workspace.root, 'native');
      const actual = join(workspace.root, 'actual');
      await mkdir(native);
      const git = args => workspace.git(args, { cwd: native });
      await git(['init', '-q', '--initial-branch=feature', `--object-format=${algorithm}`]);
      await git(['commit', '-q', '--allow-empty', '-m', 'fixture']);
      if (packed) await git(['pack-refs', '--all', '--prune']);
      await cp(native, actual, { recursive: true });
      const descriptor = await openNodeRepository({ directory: actual });
      const repo = new GitRepository(descriptor);
      t.after(async () => { repo.dispose(); await descriptor.odb.close(); });
      for (const [source, target] of [['feature', 'feature/sub'], ['feature/sub', 'feature']]) {
        await git(['branch', '-m', source, target]);
        await repo.branch(source, { rename: target, identity });
        const expected = (await git(['for-each-ref', '--format=%(refname) %(objectname)'])).text;
        assert.equal((await repo.refs.list()).map(ref => `${ref.name} ${ref.oid}`).join('\n'), expected);
        assert.equal(await repo.refs.read('HEAD', { deref: false }), (await git(['symbolic-ref', 'HEAD'])).text);
        for (const key of ['logs/HEAD', `logs/refs/heads/${target}`]) {
          assert.deepEqual(await descriptor.store.get(key), new Uint8Array(await readFile(join(native, '.git', key))), key);
        }
        assert.equal((await workspace.git(['fsck', '--no-dangling'], { cwd: actual })).code, 0);
      }
    });
  }
}
