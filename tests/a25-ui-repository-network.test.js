import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadRepositoryLfs, initializeRepositorySubmodule } from '../apps/studio/git-repository-network.js';
import { parseLfsPointer, lfsObjectKey } from '../packages/git/src/lfs.js';
import { createRepository } from '../packages/git/src/factory.js';
import { toolsWorkbench, grantToolOrigin } from './git-tools/fixture.js';
import { commitFiles, objectFixture, smartResponse, identity } from './git-adjuncts/fixture.js';

const remote = { name: 'origin', url: 'https://git.test/parent.git' };

async function missingLfsFixture(context) {
  const bytes = Uint8Array.of(0, 10, 128, 255);
  const calls = [];
  const workbench = await toolsWorkbench(context, { fetch: async (url, options) => {
    const headers = new Headers(options.headers);
    calls.push({ url, authorization: headers.get('authorization') });
    if (url.endsWith('/objects/batch')) {
      const request = JSON.parse(new TextDecoder().decode(options.body));
      assert.equal(request.objects.length, 1);
      return new Response(JSON.stringify({ objects: request.objects.map(pointer => ({ ...pointer, actions: { download: {
        href: 'https://cdn.test/lfs/object?signature=opaque-action-signature', header: { Authorization: 'Bearer action-credential' }
      } } })) }));
    }
    assert.equal(new URL(url).origin, 'https://cdn.test');
    return new Response(bytes);
  } });
  await commitFiles(workbench.repo, { '.gitattributes': '*.bin filter=lfs -text\n',
    'asset[1].bin': bytes, 'asset1.bin': Uint8Array.of(2, 3) });
  const original = await workbench.service.request('readFile', { path: 'asset[1].bin', revision: 'HEAD' });
  const pointer = parseLfsPointer(original.data);
  const decoy = await workbench.service.request('readFile', { path: 'asset1.bin', revision: 'HEAD' });
  assert.notEqual(pointer.oid, parseLfsPointer(decoy.data).oid);
  await workbench.repo.store.delete(lfsObjectKey(pointer.oid));
  await workbench.repo.worktree.write('asset[1].bin', original.data);
  await workbench.service.request('changeRemote', { action: 'add', ...remote });
  await grantToolOrigin(workbench, 'https://git.test');
  await workbench.preferences.auth('setCredential', { id: 'https://git.test', credential: {
    provider: 'github', kind: 'pat', accessToken: 'primary-credential', allowedOrigins: ['https://git.test'], scopes: ['repo']
  } });
  return { workbench, bytes, calls, file: { path: 'asset[1].bin', ...pointer, state: 'missing' }, original: original.data };
}

test('per-path LFS download requests exact connection and action grants and never forwards the primary credential to the action', async t => {
  const { workbench, file, bytes, calls } = await missingLfsFixture(t);
  const prompts = [];
  const result = await downloadRepositoryLfs(workbench, file, remote, { confirm: value => { prompts.push(value); return true; } });
  assert.equal(result.length, 1);
  assert.equal(result[0].state, 'ready');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /connect to https:\/\/cdn\.test/u);
  assert.match(prompts[1], /action credentials.*https:\/\/cdn\.test/u);
  const action = calls.find(call => new URL(call.url).origin === 'https://cdn.test');
  assert.equal(action.authorization, 'Bearer action-credential');
  const primary = `Basic ${Buffer.from('x-access-token:primary-credential').toString('base64')}`;
  assert.ok(calls.filter(call => call.url.endsWith('/objects/batch')).every(call => call.authorization === primary));
  const requests = workbench.events.filter(event => event.method === 'lfsFetch');
  assert.deepEqual(requests.at(-1).params.paths, [':(literal)asset[1].bin']);
  assert.deepEqual(requests.at(-1).params.lfsActionOrigins, ['https://cdn.test']);
  assert.equal(requests.at(-1).params.lfsActionConsent, true);
  assert.equal(requests.at(-1).params.force, false);
  assert.deepEqual((await workbench.repo.worktree.read(file.path)).data, bytes);
  assert.ok(workbench.events.some(event => event.type === 'adopt'));
  assert.doesNotMatch(JSON.stringify([prompts, workbench.repositoryToolsResult]), /primary-credential|action-credential|opaque-action-signature/u);
});

test('declining an LFS action recipient leaves the pointer and its missing state intact', async t => {
  const { workbench, file, calls, original } = await missingLfsFixture(t);
  await assert.rejects(downloadRepositoryLfs(workbench, file, remote, { confirm: message => !message.includes('action credentials') }),
    { code: 'Cancelled' });
  assert.equal(calls.some(call => new URL(call.url).origin === 'https://cdn.test'), false);
  assert.equal(await workbench.repo.store.get(lfsObjectKey(file.oid)), undefined);
  assert.deepEqual((await workbench.repo.worktree.read(file.path)).data, original);
  assert.equal(workbench.events.some(event => event.type === 'adopt'), false);
});

test('submodule initialization binds visible path, URL and pinned ID before opening nested storage', async t => {
  const fixture = await objectFixture(t);
  let opened = 0;
  const workbench = await toolsWorkbench(t, {
    fetch: (url, request) => Promise.resolve(smartResponse(fixture, { ...request, url })),
    submodules: { createRepository: async () => { opened++; return createRepository(); } }
  });
  await commitFiles(workbench.repo, { '.gitmodules': '[submodule "library"]\n path = deps/library\n url = ../library.git\n' });
  workbench.repo.index.set({ path: 'deps/library', oid: fixture.tip, mode: 0o160000, stage: 0 });
  await workbench.repo.saveIndex();
  await workbench.repo.commit({ message: 'pin library', author: identity, committer: identity });
  await workbench.service.request('changeRemote', { action: 'add', ...remote });
  await grantToolOrigin(workbench, 'https://git.test');
  const [module] = await workbench.service.request('submodules');
  await assert.rejects(initializeRepositorySubmodule(workbench, { ...module, oid: 'a'.repeat(40) }), { code: 'Conflict' });
  await assert.rejects(initializeRepositorySubmodule(workbench, module, { confirm: () => false }), { code: 'Cancelled' });
  assert.equal(opened, 0);
  let prompt;
  const result = await initializeRepositorySubmodule(workbench, module, { confirm: value => { prompt = value; return true; } });
  assert.match(prompt, /Path: deps\/library/u);
  assert.match(prompt, /URL: https:\/\/git\.test\/library\.git/u);
  assert.ok(prompt.includes(`Pinned commit: ${fixture.tip}`));
  assert.equal(opened, 1);
  assert.equal(result[0].state, 'initialized');
  const request = workbench.events.find(event => event.method === 'initializeSubmodules');
  assert.deepEqual(request.params.trustedSubmodules, [{ path: module.path, url: module.url, oid: fixture.tip }]);
  assert.deepEqual(request.params.paths, ['deps/library']);
  assert.equal(request.params.recursive, false);
});
