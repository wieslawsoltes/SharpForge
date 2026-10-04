import test from 'node:test';
import assert from 'node:assert/strict';
import { GitError, createGitAuthContext, createAuthOperations, requiredGitOrigins } from '@sharpforge/git';
import { openSnapshotFromRemote, commitProviderSnapshot, snapshotChanges } from '../apps/studio/git-snapshot.js';
import { authorizeProviderTarget, providerTarget } from '../apps/studio/git-provider-session.js';

const remote = 'https://github.com/acme/project';
const remoteId = 'https://github.com';
const initialOid = 'a'.repeat(40);
const initialTree = 'b'.repeat(40);
const sourceBlob = 'c'.repeat(40);
const binaryBlob = 'd'.repeat(40);
const nextOid = 'e'.repeat(40);
const binary = new Uint8Array([0, 1, 254, 255]);
const writeConsent = { remoteId, scope: 'push', confirmed: true };

async function studioFixture({ conflict = false } = {}) {
  const calls = [];
  const context = createGitAuthContext();
  await context.invoke('setCredential', { id: 'account', remoteId, grantConsent: true,
    origins: requiredGitOrigins(remote, { provider: 'github' }), credential: {
      provider: 'github', kind: 'pat', accessToken: 'fixture-access', allowedOrigins: requiredGitOrigins(remote, { provider: 'github' }), scopes: []
    } });
  const json = value => Response.json(value, { headers: { 'x-oauth-scopes': 'repo' } });
  const operations = createAuthOperations(context, { fetch: async (url, request) => {
    const path = new URL(url).pathname;
    calls.push({ path, request });
    if (path.endsWith('/git/matching-refs/')) return json([{ ref: 'refs/heads/main', object: { sha: initialOid } }]);
    if (path.endsWith(`/git/commits/${initialOid}`)) return json({ sha: initialOid, tree: { sha: initialTree }, parents: [], message: 'Initial' });
    if (path.endsWith(`/git/trees/${initialTree}`)) return json({ tree: [
      { path: 'Program.cs', type: 'blob', sha: sourceBlob, mode: '100644' }, { path: 'image.bin', type: 'blob', sha: binaryBlob, mode: '100644' }
    ] });
    if (path.endsWith(`/git/blobs/${sourceBlob}`)) return json({ encoding: 'base64', content: btoa('class Program {}\r\n') });
    if (path.endsWith(`/git/blobs/${binaryBlob}`)) return json({ encoding: 'base64', content: 'AAH+/w==' });
    if (path.endsWith('/git/blobs') && request.method === 'POST') return json({ sha: sourceBlob });
    if (path.endsWith('/git/trees') && request.method === 'POST') return json({ sha: initialTree });
    if (path.endsWith('/git/commits') && request.method === 'POST') return json({ sha: nextOid });
    if (path === '/repos/acme/project') return json({ node_id: 'RepositoryNode' });
    if (path === '/graphql') return json(conflict ? { errors: [{ message: 'beforeOid mismatch' }] } : { data: { updateRefs: {} } });
    throw new Error('Unexpected fixture endpoint');
  } });
  let records = [];
  let identity = 'old-workspace';
  const workbench = {
    repositoryId: 'old-repository', workspaceBound: true, synced: new Map(), credentialIds: new Map([[remoteId, 'account']]),
    host: {
      async adoptRecords(value, options) {
        assert.equal(options.openWorkspace, true);
        options.validate();
        records = value;
        identity = 'snapshot-workspace';
        options.onCommitted();
        return true;
      },
      snapshot: () => records, getWorkspaceIdentity: () => identity, showPanel() {},
      applyEdits(edits) { for (const edit of edits) records.find(record => record.path === edit.uri).text = edit.newText; }
    },
    preferences: { model: { values: { userName: 'Fixture', userEmail: 'fixture@example.com' } },
      auth: (method, input) => context.invoke(method, input),
      grant: (url, provider) => context.invoke('grant', { remoteId, origins: requiredGitOrigins(url, { provider }), consent: true }) },
    confirmWorkspaceReplacement() {},
    request(method, params, options = {}) {
      assert.equal(method, 'git.snapshot');
      return operations.find(operation => operation.name === method).run(null, params, options);
    }
  };
  return { workbench, context, calls, records: () => records, switchWorkspace: () => { identity = 'different-workspace'; } };
}

test('A25 Studio snapshot host seam opens actual source records, preserves binary bytes, and commits by CAS with zero smart HTTP', async () => {
  const { workbench, context, calls, records } = await studioFixture();
  await openSnapshotFromRemote(workbench, remote, 'github', { confirmMetadata: () => true });
  assert.equal(workbench.repositoryId, null);
  assert.equal(workbench.workspaceBound, false);
  const sourceRecord = records().find(record => record.path === 'Program.cs');
  const binaryRecord = records().find(record => record.path === 'image.bin');
  assert.equal(sourceRecord.text, 'class Program {}\r\n');
  assert.deepEqual(binaryRecord.bytes, binary);
  assert.deepEqual(await snapshotChanges(workbench.providerSnapshot, records()), []);
  workbench.host.applyEdits([{ uri: 'Program.cs', newText: 'class Program { static void Main() {} }\r\n' }]);
  const result = await commitProviderSnapshot(workbench, { message: 'Edit Program', writeConsent });
  assert.equal(result.oid, nextOid);
  assert.equal(workbench.providerSnapshot.oid, nextOid);
  const blobs = calls.filter(value => value.path.endsWith('/git/blobs'));
  assert.equal(blobs.length, 1);
  assert.equal(atob(JSON.parse(blobs[0].request.body).content), sourceRecord.text);
  const update = JSON.parse(calls.find(value => value.path === '/graphql').request.body).variables.input.refUpdates[0];
  assert.equal(update.beforeOid, initialOid);
  assert.equal(update.afterOid, nextOid);
  assert.equal(update.force, false);
  assert.deepEqual(binaryRecord.bytes, binary);
  assert.equal(calls.some(value => /git-upload-pack|git-receive-pack|info\/refs/.test(value.path)), false);
  await context.dispose();
});

test('A25 Studio snapshot blocks unconfirmed writes and workspace switches; CAS failure retains its original baseline', async () => {
  const { workbench, context, calls, switchWorkspace } = await studioFixture({ conflict: true });
  await openSnapshotFromRemote(workbench, remote, 'github', { confirmMetadata: () => true });
  workbench.host.applyEdits([{ uri: 'Program.cs', newText: 'class Changed {}' }]);
  const before = calls.length;
  await assert.rejects(commitProviderSnapshot(workbench, { message: 'Denied' }), { code: 'Auth' });
  assert.equal(calls.length, before);
  await assert.rejects(commitProviderSnapshot(workbench, { message: 'Stale commit', writeConsent }), { code: 'Conflict' });
  assert.equal(workbench.providerSnapshot.oid, initialOid);
  assert.equal(new TextDecoder().decode(workbench.providerSnapshot.baseline.get('Program.cs').content), 'class Program {}\r\n');
  switchWorkspace();
  const requests = calls.length;
  await assert.rejects(commitProviderSnapshot(workbench, { message: 'Wrong workspace', writeConsent }), { code: 'Conflict' });
  assert.equal(calls.length, requests);
  await context.dispose();
});

test('A25 provider UI account resolver grants first, filters exact recipients, and returns a closed target', async () => {
  const order = [];
  const workbench = { credentialIds: new Map([[remoteId, 'selected']]), preferences: {
    async grant() { order.push('grant'); }, async auth() {
      order.push('accounts');
      return [
        { id: 'selected', provider: 'github', allowedOrigins: ['https://api.github.com'] },
        { id: 'other-host', provider: 'github', allowedOrigins: ['https://evil.example'] }
      ];
    }
  } };
  const value = await authorizeProviderTarget(workbench, { ...providerTarget(remote, 'github'), baseline: new Map() });
  assert.deepEqual(order, ['grant', 'accounts']);
  assert.equal(value.credentialId, 'selected');
  assert.equal(Object.hasOwn(value, 'baseline'), false);
  await assert.rejects(authorizeProviderTarget(workbench, value, 'other-host'), { code: 'Auth' });
  assert.throws(() => providerTarget('https://user:secret@github.com/acme/project', 'github'), { code: 'Unsafe' });
});

test('A25 snapshot respects live-document guards and cancels before any provider effects', async () => {
  const { workbench, context, calls } = await studioFixture();
  workbench.assertWorktreeChange = () => { throw new GitError('Conflict', 'Live document is active'); };
  await assert.rejects(openSnapshotFromRemote(workbench, remote, 'github', { confirmMetadata: () => true }), { code: 'Conflict' });
  assert.equal(calls.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(openSnapshotFromRemote(workbench, remote, 'github', {
    signal: controller.signal, confirmMetadata: () => { throw new Error('No prompt after cancellation'); }
  }), { code: 'Cancelled' });
  assert.equal(calls.length, 0);
  await context.dispose();
});

for (const rejectAgain of [false, true]) {
  test(`A25 private snapshot sign-in retries once and ${rejectAgain ? 'surfaces a second Auth failure' : 'opens after authentication'}`, async () => {
    const { workbench, context } = await studioFixture();
    const request = workbench.request;
    let refRequests = 0;
    let signIns = 0;
    let disposedBlame = 0;
    workbench.blameMargin = { dispose() { disposedBlame++; } };
    workbench.aheadBehind = { ahead: 10, behind: 3 };
    workbench.request = (method, params, options) => {
      if (params.operation === 'refs' && (++refRequests === 1 || rejectAgain)) throw new GitError('Auth', 'Private repository');
      return request(method, params, options);
    };
    workbench.preferences.signIn = async () => { signIns++; return { id: 'account' }; };
    const result = openSnapshotFromRemote(workbench, remote, 'github', { confirmMetadata: () => true });
    if (rejectAgain) await assert.rejects(result, { code: 'Auth' });
    else {
      await result;
      assert.equal(disposedBlame, 1);
      assert.equal(workbench.aheadBehind, null);
    }
    assert.equal(refRequests, 2);
    assert.equal(signIns, 1);
    await context.dispose();
  });
}
