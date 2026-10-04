import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLfsPointer } from '@sharpforge/git';
import { openService, identity, remoteUrl } from './git-adjuncts/fixture.js';

async function commitRevision(service, repo, sequence) {
  const files = {
    '.gitattributes': '*.bin filter=lfs -text\n',
    '.gitmodules': '[submodule "child"]\n path = deps/child\n url = ../child.git\n',
    'asset.bin': Uint8Array.of(0, sequence, 255),
    'readme.txt': `revision ${sequence}\n`
  };
  for (const [path, data] of Object.entries(files)) await service.request('writeFile', { path, data });
  await service.request('add', { paths: Object.keys(files) });
  const pin = String(sequence).repeat(40);
  repo.index.set({ path: 'deps/child', mode: 0o160000, oid: pin, stage: 0 });
  await repo.saveIndex();
  const commit = await service.request('commit', { message: `revision ${sequence}`, author: identity, committer: identity });
  const pointer = parseLfsPointer((await service.request('readFile', { path: 'asset.bin', revision: commit.oid })).data);
  assert.ok(pointer);
  return { ...commit, pin, pointer };
}

test('service mutation counters preserve default and explicit Git revisions in log, submodules and LFS', async context => {
  let networkRequests = 0;
  const { service, repo } = await openService(context, {}, { fetch: async () => {
    networkRequests++;
    throw new Error('Local revision inspection must not contact a remote');
  } });
  await service.request('changeRemote', { action: 'add', name: 'origin', url: remoteUrl });
  const first = await commitRevision(service, repo, 1);
  const second = await commitRevision(service, repo, 2);
  assert.ok(service.describeRepositories()[0].revision > 1, 'The service counter differs from every Git revision selector');

  assert.deepEqual((await service.request('log')).map(commit => commit.oid), [second.oid, first.oid]);
  assert.deepEqual((await service.request('log', { revision: 'HEAD~1' })).map(commit => commit.oid), [first.oid]);
  const currentModule = (await service.request('submodules'))[0];
  const previousModule = (await service.request('submodules', { revision: first.oid }))[0];
  assert.equal(currentModule.path, 'deps/child');
  assert.equal(currentModule.oid, second.pin);
  assert.equal(previousModule.oid, first.pin);
  assert.equal(previousModule.url, 'https://git.test/child.git');
  assert.equal(currentModule.state, 'uninitialized');

  const currentLfs = (await service.request('lfsStatus'))[0];
  const previousLfs = (await service.request('lfsStatus', { revision: 'HEAD~1' }))[0];
  assert.deepEqual(currentLfs, { path: 'asset.bin', oid: second.pointer.oid, size: 3, state: 'ready' });
  assert.deepEqual(previousLfs, { path: 'asset.bin', oid: first.pointer.oid, size: 3, state: 'ready' });
  assert.notEqual(currentLfs.oid, previousLfs.oid);
  for (const operation of ['log', 'submodules', 'lfsStatus']) {
    await assert.rejects(service.request(operation, { revision: 'refs/heads/missing' }), { code: 'NotFound' });
  }
  assert.equal(networkRequests, 0);
});
