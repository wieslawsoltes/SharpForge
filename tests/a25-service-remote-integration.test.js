import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitAuthContext } from '../packages/git/src/auth/context.js';
import { createRepository } from '../packages/git/src/factory.js';
import { createRemoteAccess } from '../packages/git/src/remote-operations.js';
import { validatePushPolicy } from '../packages/git/src/push-policy.js';
import { encodeCommit } from '../packages/git/src/objects.js';
import { encodePackets } from '../packages/git/src/protocol/pktline.js';
import { collectBytes } from '../packages/git/src/protocol/bytes.js';
import { parseLfsPointer, lfsObjectKey } from '../packages/git/src/lfs.js';
import { readPack } from '../packages/git/src/pack/reader.js';
import { PromisorDatabase } from '../packages/git/src/promisor.js';
import { CLONE_JOURNAL_KEY } from '../packages/git/src/clone.js';
import { openService, commitFiles, authorize, objectFixture, smartResponse, identity, text, decode, remoteUrl } from './git-adjuncts/fixture.js';

test('explicit anonymous selection suppresses configured and supplied credentials and rejects push before network access', async t => {
  const fixture = await objectFixture(t);
  const headers = [];
  const { service, repo } = await openService(t, {}, { fetch: async (_, request) => {
    headers.push(new Headers(request.headers).get('authorization'));
    return smartResponse(fixture, request);
  } });
  const authorization = await authorize(service, { write: true });
  repo.config.set('remote.origin.url', remoteUrl);
  repo.config.set('sharpforge.origin.credentialid', authorization.credentialId);
  await repo.config.save();
  await service.request('remoteRefs', { ...authorization, anonymous: true });
  assert.ok(headers.length > 0);
  assert.ok(headers.every(value => value === null));
  const anonymousRequests = headers.length;
  await service.request('remoteRefs');
  assert.ok(headers.length > anonymousRequests);
  assert.ok(headers.slice(anonymousRequests).every(value => typeof value === 'string' && value.length > 0));
  const beforePush = headers.length;
  await assert.rejects(service.request('push', { ...authorization, anonymous: true }), { code: 'Auth' });
  assert.equal(headers.length, beforePush);
});

test('partial clone hydrates only requested missing bytes, preserves FETCH_HEAD and retries a failed checkout safely', async t => {
  const fixture = await objectFixture(t);
  const requests = [];
  let rejectContent = true;
  const { service, repo } = await openService(t, {}, { fetch: async (url, request) => {
    const body = request.body ? decode(request.body) : '';
    requests.push({ url, method: request.method, body });
    if (rejectContent && body.includes('command=fetch') && !body.includes('filter blob:none')) {
      return new Response('Authentication required', { status: 401 });
    }
    return smartResponse(fixture, request, { partial: true });
  } });
  await authorize(service);
  const params = { url: remoteUrl, filter: 'blob:none' };
  await assert.rejects(service.request('clone', params), { code: 'Auth' });
  assert.deepEqual(await repo.odb.list(), []);
  assert.deepEqual(await repo.worktree.list(), []);
  assert.equal(repo.index.entries.length, 0);
  assert.equal(await repo.refs.read('HEAD'), null);
  assert.equal(repo.config.get('remote.origin.url'), undefined);
  assert.equal(await repo.store.get('sharpforge/promisor'), undefined);
  assert.equal(await repo.store.get(CLONE_JOURNAL_KEY), undefined);
  assert.equal(repo.graph.odb, repo.odb);
  assert.equal(repo.odb instanceof PromisorDatabase, false);
  rejectContent = false;
  requests.length = 0;
  const result = await service.request('clone', params);
  assert.equal(result.oid, fixture.tip);
  assert.equal(await repo.refs.read('HEAD', { deref: false }), 'refs/heads/main');
  assert.deepEqual((await repo.worktree.read('README.md')).data, text('fixture content\n'));
  assert.ok(repo.odb instanceof PromisorDatabase);
  assert.equal(repo.graph.odb, repo.odb);
  const fetches = requests.filter(request => request.body.includes('command=fetch'));
  assert.equal(fetches.length, 2);
  assert.ok(fetches[0].body.includes('filter blob:none'));
  assert.ok(fetches[1].body.includes('want ' + fixture.blob));
  assert.equal(fetches[1].body.includes('filter '), false);
  assert.equal(fetches[1].body.includes('have '), false);
  assert.ok(decode(await repo.store.get('FETCH_HEAD')).includes('refs/heads/main of ' + remoteUrl));
  assert.deepEqual((await repo.refs.list()).map(ref => ref.name),
    ['refs/heads/main', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  assert.equal(await repo.refs.read('refs/remotes/origin/HEAD', { deref: false }), 'refs/remotes/origin/main');
});

test('service binds force-with-lease confirmation to exact remote, reference, old ID, new ID and current write consent', async t => {
  const auth = createGitAuthContext();
  const { service, repo } = await openService(t, {}, { authContext: auth });
  const authorization = await authorize(service, { write: true });
  const { oid: base, tree } = await commitFiles(repo, { 'base.txt': 'base' });
  const commit = message => repo.odb.write('commit', encodeCommit({
    tree, parents: [base], author: identity, committer: identity, message
  }));
  const left = await commit('left');
  const right = await commit('right');
  const name = 'refs/heads/main';
  const confirmation = { confirmed: true, remoteId: authorization.remoteId,
    action: 'force-with-lease', ref: name, expected: left, newOid: right };
  const access = createRemoteAccess(auth);
  const prepared = await access.prepare(repo, { url: remoteUrl, ...authorization,
    leases: { [name]: left }, confirmation, verifyConfirmation: async () => true }, {}, { push: true });
  t.after(prepared.dispose);
  const policy = { ...prepared.options, remoteRefs: [{ name, oid: left }], updates: [{ name, newOid: right }] };
  assert.equal((await validatePushPolicy(policy))[0].oldOid, left);
  for (const change of [{ remoteId: 'https://other.test' }, { ref: 'refs/heads/other' }, { expected: base },
    { newOid: base }, { action: 'force-push' }, { confirmed: false }]) {
    await assert.rejects(validatePushPolicy({ ...policy, confirmation: { ...confirmation, ...change } }), { code: 'Auth' });
  }
  await assert.rejects(validatePushPolicy({ ...policy, leases: { [name]: base } }), { code: 'Conflict' });
  await assert.rejects(access.prepare(repo, { url: remoteUrl, ...authorization,
    writeConsent: { confirmed: true, remoteId: 'https://other.test', scope: 'push' } }, {}, { push: true }), { code: 'Auth' });
  const denied = await access.prepare(repo, { url: remoteUrl, ...authorization, leases: { [name]: left },
    confirmation: {}, verifyConfirmation: async () => true }, {}, { push: true });
  try {
    await assert.rejects(validatePushPolicy({ ...policy, ...denied.options }), { code: 'Auth' });
  } finally { denied.dispose(); }
});

test('service uploads LFS bytes once before receive-pack and resolves the received pointer through a fresh download', async t => {
  const actions = [];
  const storageOrigin = 'https://lfs-storage.test';
  const actionToken = 'Bearer fixture-action-token';
  let pointer;
  let receiver;
  let receivedOid;
  let uploads = 0;
  const uploadedObjects = new Map();
  const binary = Uint8Array.from([0, 1, 2, 255]);
  const fetch = async (url, request) => {
    const endpoint = new URL(url);
    if (request.method === 'GET' && endpoint.origin !== storageOrigin) {
      actions.push('advertise');
      return new Response(encodePackets(['0'.repeat(40) + ' capabilities^{}\0report-status atomic object-format=sha1\n']));
    }
    if (endpoint.pathname.endsWith('/objects/batch')) {
      const input = JSON.parse(decode(request.body));
      actions.push(input.operation === 'download' ? 'lfs-download-batch' : 'lfs-batch');
      assert.deepEqual(input.objects, [{ oid: pointer.oid, size: binary.length }]);
      if (input.operation === 'download') return Response.json({ transfer: 'basic', objects: [{
        ...input.objects[0], actions: { download: { href: `${storageOrigin}/object/${input.objects[0].oid}`, header: { Authorization: actionToken } } }
      }] });
      assert.equal(input.operation, 'upload');
      return Response.json({ transfer: 'basic', objects: [{ oid: pointer.oid, size: binary.length, actions: {
        upload: { href: storageOrigin + '/object', header: { Authorization: actionToken } },
        verify: { href: storageOrigin + '/verify', header: { Authorization: actionToken } }
      } }] });
    }
    if (endpoint.origin === storageOrigin) {
      assert.equal(new Headers(request.headers).get('authorization'), actionToken);
      if (request.method === 'PUT') {
        actions.push('lfs-upload');
        uploads++;
        const uploaded = await collectBytes(request.body);
        assert.deepEqual(uploaded, binary);
        uploadedObjects.set(pointer.oid, uploaded.slice());
      } else if (request.method === 'GET') {
        actions.push('lfs-download');
        const stored = uploadedObjects.get(endpoint.pathname.split('/').at(-1));
        assert.ok(stored, 'download must serve the bytes actually uploaded');
        return new Response(stored.slice(), { headers: { 'Content-Type': 'application/octet-stream' } });
      } else {
        actions.push('lfs-verify');
        assert.deepEqual(JSON.parse(decode(request.body)), { oid: pointer.oid, size: binary.length });
        assert.ok(uploadedObjects.has(pointer.oid));
      }
      return new Response(null, { status: 200 });
    }
    actions.push('git-push');
    const bytes = await collectBytes(request.body);
    const commandLength = Number.parseInt(decode(bytes.subarray(0, 4)), 16);
    const [oldOid, nextOid, ref] = decode(bytes.subarray(4, commandLength)).split('\0')[0].trim().split(' ');
    assert.equal(oldOid, '0'.repeat(40));
    assert.equal(ref, 'refs/heads/main');
    assert.equal(decode(bytes.subarray(commandLength, commandLength + 4)), '0000');
    await readPack(bytes.subarray(commandLength + 4), { odb: receiver.repo.odb });
    await receiver.repo.refs.update(ref, nextOid, { expected: null });
    receivedOid = nextOid;
    return new Response(encodePackets(['unpack ok\n', 'ok refs/heads/main\n']));
  };
  const { service, repo } = await openService(t, {}, { fetch });
  receiver = await openService(t, { defaultBranch: 'download' }, { fetch });
  await commitFiles(repo, { '.gitattributes': '*.bin filter=lfs -text\n', 'asset.bin': binary });
  const object = await repo.odb.read(repo.index.get('asset.bin').oid);
  pointer = parseLfsPointer(object.data);
  const authorization = await authorize(service, { origins: ['https://git.test', storageOrigin], write: true });
  const params = { url: remoteUrl, ...authorization };
  await assert.rejects(service.request('push', params), { code: 'Auth' });
  assert.deepEqual(actions, ['advertise', 'lfs-batch']);
  actions.length = 0;
  const result = await service.request('push', { ...params, lfsActionOrigins: [storageOrigin], lfsActionConsent: true });
  assert.deepEqual(actions, ['advertise', 'lfs-batch', 'lfs-upload', 'lfs-verify', 'git-push']);
  assert.equal(result.unpack, 'ok');
  assert.equal(await repo.refs.read('refs/remotes/origin/main'), await repo.refs.read('HEAD'));
  assert.equal(receivedOid, await receiver.repo.refs.read('refs/heads/main'));
  assert.equal(receivedOid, await repo.refs.read('HEAD'));
  const receivedEntry = (await receiver.repo.readTree(receivedOid)).get('asset.bin');
  const receivedBlob = await receiver.repo.odb.read(receivedEntry.oid);
  assert.deepEqual(parseLfsPointer(receivedBlob.data), pointer);
  assert.equal(await receiver.repo.store.get(lfsObjectKey(pointer.oid)), undefined);
  await receiver.service.request('checkout', { revision: 'main' });
  assert.deepEqual((await receiver.repo.worktree.read('asset.bin')).data, receivedBlob.data);
  const downloadAuthorization = await authorize(receiver.service, { origins: ['https://git.test', storageOrigin] });
  const downloaded = await receiver.service.request('lfsFetch', { url: remoteUrl, ...downloadAuthorization,
    paths: ['asset.bin'], materialize: true, lfsActionOrigins: [storageOrigin], lfsActionConsent: true });
  assert.deepEqual(downloaded, [{ path: 'asset.bin', oid: pointer.oid, size: binary.length, state: 'ready', cached: false }]);
  assert.deepEqual((await receiver.repo.worktree.read('asset.bin')).data, binary);
  assert.deepEqual(await receiver.repo.store.get(lfsObjectKey(pointer.oid)), uploadedObjects.get(pointer.oid));
  assert.deepEqual(actions, ['advertise', 'lfs-batch', 'lfs-upload', 'lfs-verify', 'git-push', 'lfs-download-batch', 'lfs-download']);
  assert.equal(uploads, 1);
});

test('loopback allowance comes only from exact service configuration and cannot be enabled by an RPC parameter', async t => {
  const fixture = await objectFixture(t);
  const url = 'http://127.0.0.1:9876/fixture.git';
  let calls = 0;
  const fetch = async (_, request) => { calls++; return smartResponse(fixture, request); };
  const blocked = await openService(t, {}, { fetch });
  await assert.rejects(blocked.service.request('remoteRefs', { url, allowInsecureLocalhost: true }), { code: 'Unsafe' });
  assert.equal(calls, 0);
  const permitted = await openService(t, {}, { fetch, allowInsecureLocalhost: true, localOrigins: ['http://127.0.0.1:9876'] });
  const refs = await permitted.service.request('remoteRefs', { url });
  assert.equal(refs.refs.find(ref => ref.name === 'refs/heads/main').oid, fixture.tip);
  await assert.rejects(permitted.service.request('remoteRefs', { url: 'http://127.0.0.1:9877/fixture.git' }), { code: 'Unsafe' });
});

test('aheadBehind derives configured branch tracking refs and preserves invalid-reference errors', async t => {
  const { service, repo } = await openService(t);
  assert.equal(await service.request('aheadBehind'), null);
  const base = await commitFiles(repo, { 'file.txt': 'base' });
  assert.equal(await service.request('aheadBehind'), null);
  await repo.refs.update('refs/remotes/origin/main', base.oid);
  repo.config.set('branch.main.remote', 'origin');
  repo.config.set('branch.main.merge', 'refs/heads/main');
  await repo.config.save();
  await commitFiles(repo, { 'file.txt': 'next' }, 'next');
  assert.deepEqual(await service.request('aheadBehind'), { ahead: 1, behind: 0 });
  assert.deepEqual(await service.request('aheadBehind', { local: 'refs/remotes/origin/main', upstream: 'refs/heads/main' }),
    { ahead: 0, behind: 1 });
  await assert.rejects(service.request('aheadBehind', { local: '../unsafe', upstream: 'refs/heads/main' }), { code: 'Unsafe' });
});

test('trusted submodule service clone materializes the pinned commit through host-owned nested storage', async t => {
  const fixture = await objectFixture(t);
  let closed;
  let created = 0;
  const { service, repo } = await openService(t, {}, {
    fetch: async (_, request) => smartResponse(fixture, request),
    submodules: { createRepository: async () => {
      created++;
      const opened = await createRepository();
      return { repository: opened.repository, dispose: async () => {
        closed = { head: await opened.repository.refs.read('HEAD', { deref: false }),
          file: await opened.repository.worktree.read('README.md') };
        await opened.dispose();
      } };
    } }
  });
  await commitFiles(repo, { '.gitmodules': '[submodule "library"]\n path = deps/library\n url = ../library.git\n' });
  repo.index.set({ path: 'deps/library', oid: fixture.tip, mode: 0o160000, stage: 0 });
  await repo.saveIndex();
  await repo.commit({ message: 'pin library', author: identity, committer: identity });
  repo.config.set('remote.origin.url', remoteUrl);
  await repo.config.save();
  await authorize(service);
  const result = await service.request('initializeSubmodules', {
    trustedSubmodules: [{ path: 'deps/library', url: 'https://git.test/library.git' }]
  });
  assert.equal(created, 1);
  assert.equal(result[0].state, 'initialized');
  assert.equal(closed.head, fixture.tip);
  assert.deepEqual(closed.file.data, text('fixture content\n'));
});
