import test from 'node:test';
import assert from 'node:assert/strict';
import { GitService } from '../packages/git/src/service.js';
import { createRemoteOperations } from '../packages/git/src/remote-operations.js';
import { createGitAuthContext } from '../packages/git/src/auth/context.js';
import { createAuthOperations } from '../packages/git/src/auth/service.js';
import { requiredGitOrigins } from '../packages/git/src/origins.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { encodePackets, encodePktLine } from '../packages/git/src/protocol/pktline.js';
import { concatBytes } from '../packages/git/src/protocol/bytes.js';
import { repository, commitFile, fileText } from './a25-workflow-fixtures.js';
import { checkoutGitPullRequest, currentGitPullRequestBranch } from '../apps/studio/git-pull-requests.js';

async function fixture(t, { stale = false, forkOrigin = 'https://github.com', provider = 'github' } = {}) {
  const local = await repository();
  const initial = await commitFile(local, 'Program.cs', 'class Local {}\n');
  const source = await repository();
  const commit = await commitFile(source, 'Program.cs', 'class Reviewed {}\n');
  const { pack } = await writePack(await Promise.all((await source.odb.list()).map(key => source.odb.read(key))));
  const auth = createGitAuthContext();
  const remote = `${provider === 'github' ? 'https://github.com' : 'https://gitea.example'}/acme/project`;
  const sourceRemote = `${forkOrigin}/fork/project`;
  const target = { remote, remoteId: new URL(remote).origin, provider, credentialId: 'target-account' };
  await auth.invoke('setCredential', { id: 'target-account', remoteId: target.remoteId,
    origins: requiredGitOrigins(remote, { provider }), grantConsent: true,
    credential: { kind: 'pat', provider, accessToken: 'target-fixture-token',
    allowedOrigins: requiredGitOrigins(remote, { provider }) } });
  let workspace = 'fixture-workspace';
  const calls = [];
  const options = { fetch: async (url, request) => {
    const parsed = new URL(url);
    calls.push({ parsed, request });
    if (parsed.pathname.endsWith('/pulls/7')) return Response.json({ number: 7, title: 'Review', head: {
      sha: stale ? 'd'.repeat(40) : commit.oid, ref: 'feature', repo: { clone_url: sourceRemote } }, base: { ref: 'main' } });
    if (forkOrigin !== new URL(remote).origin) assert.equal(new Headers(request.headers).has('Authorization'), false);
    if (request.method === 'GET') return new Response(encodePackets(['version 2\n', 'ls-refs=unborn\n', 'fetch=shallow\n', 'object-format=sha1\n']),
      { headers: { 'Content-Type': 'application/x-git-upload-pack-advertisement' } });
    if (new TextDecoder().decode(request.body).includes('command=ls-refs')) return new Response(encodePackets([
      `${commit.oid} HEAD symref-target:refs/heads/feature\n`, `${commit.oid} refs/heads/feature\n`
    ]), { headers: { 'Content-Type': 'application/x-git-upload-pack-result' } });
    return new Response(concatBytes([encodePktLine('packfile\n'), encodePktLine(concatBytes([Uint8Array.of(1), pack])),
      encodePktLine({ kind: 'flush' })]), { headers: { 'Content-Type': 'application/x-git-upload-pack-result' } });
  } };
  const service = new GitService({ repositoryFactory: async () => local,
    operations: [...createAuthOperations(auth, options), ...createRemoteOperations(auth, options)], resources: [auth] });
  service.attach('local', local);
  t.after(() => service.dispose());
  t.after(() => source.dispose());
  const workbench = { repositoryId: 'local', workspaceBound: true, credentialIds: new Map([[target.remoteId, 'target-account']]),
    request: (name, params = {}, options) => service.request(name, { repositoryId: 'local', ...params }, options),
    host: { getWorkspaceIdentity: () => workspace, getState: () => ({ dirtyFiles: [] }) },
    preferences: {
      auth: (method, input, options) => auth.invoke(method, input, options),
      grant: (url, provider) => auth.invoke('grant', { remoteId: new URL(url).origin, origins: requiredGitOrigins(url, { provider }), consent: true }),
      async networkParameters(remote, { anonymous }) { return { url: remote.url, remoteId: new URL(remote.url).origin,
        remoteName: remote.name, credentialId: anonymous ? undefined : workbench.credentialIds.get(new URL(remote.url).origin) }; }
    },
    async synchronize() {},
    async adoptRepository() { workbench.adoptedText = await fileText(local, 'Program.cs'); }
  };
  return { local, initial, commit, workbench, calls, target, auth, switchWorkspace: () => { workspace = 'other-workspace'; } };
}

test('A25 PR checkout fetches verified canonical objects and creates a real tracking branch through GitService', async t => {
  const { local, commit, workbench, target, calls } = await fixture(t);
  const result = await checkoutGitPullRequest(workbench, target, 7);
  assert.equal(result.oid, commit.oid);
  assert.equal((await local.refs.resolve('HEAD')).ref, 'refs/heads/pr/github-7');
  await local.config.load();
  assert.equal(local.config.get('branch.pr/github-7.remote'), 'pr-github-7');
  assert.equal(local.config.get('branch.pr/github-7.merge'), 'refs/heads/feature');
  assert.equal(await local.refs.read('refs/remotes/pr-github-7/feature'), commit.oid);
  assert.equal(workbench.adoptedText, 'class Reviewed {}\n');
  assert.equal(await currentGitPullRequestBranch(workbench), 'pr/github-7');
  assert.equal(calls.filter(call => call.parsed.pathname.includes('git-upload-pack')).every(call => call.parsed.pathname.startsWith('/fork/project/')), true);
});

test('A25 PR checkout rejects a moved source before creating a branch or changing HEAD', async t => {
  const { local, initial, workbench, target } = await fixture(t, { stale: true });
  await assert.rejects(checkoutGitPullRequest(workbench, target, 7), { code: 'Conflict' });
  assert.equal(await local.refs.read('refs/heads/pr/github-7'), null);
  assert.equal((await local.refs.resolve('HEAD')).oid, initial.oid);
  assert.equal(workbench.adoptedText, undefined);
});

test('A25 PR checkout never forwards the target account to a fork on another granted Gitea origin', async t => {
  const { workbench, target, auth } = await fixture(t, { provider: 'gitea', forkOrigin: 'https://fork.example' });
  await checkoutGitPullRequest(workbench, target, 7);
  assert.deepEqual(auth.grants.list('https://fork.example'), ['https://fork.example']);
  assert.equal(workbench.credentialIds.has('https://fork.example'), false);
});

test('A25 PR checkout guards live workspace replacement, cancellation and dirty buffers', async t => {
  const { local, initial, workbench, target, calls } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(checkoutGitPullRequest(workbench, target, 7, { signal: controller.signal }), { code: 'Cancelled' });
  assert.equal(calls.length, 0);
  workbench.assertWorktreeChange = () => { throw new Error('Live collaboration active'); };
  await assert.rejects(checkoutGitPullRequest(workbench, target, 7), /Live collaboration/);
  assert.equal(calls.length, 0);
  workbench.assertWorktreeChange = () => {};
  workbench.host.getState = () => ({ dirtyFiles: ['Program.cs'] });
  await assert.rejects(checkoutGitPullRequest(workbench, target, 7), { code: 'Conflict' });
  assert.equal((await local.refs.resolve('HEAD')).oid, initial.oid);
  assert.equal(await fileText(local, 'Program.cs'), 'class Local {}\n');
  assert.equal(workbench.adoptedText, undefined);
});

test('A25 PR checkout stops if the workspace changes while resolving the source account', async t => {
  const { local, initial, workbench, target, switchWorkspace } = await fixture(t);
  const grant = workbench.preferences.grant;
  let grants = 0;
  workbench.preferences.grant = async (...args) => {
    await grant(...args);
    if (++grants === 2) switchWorkspace();
  };
  await assert.rejects(checkoutGitPullRequest(workbench, target, 7), { code: 'Conflict' });
  assert.equal((await local.refs.resolve('HEAD')).oid, initial.oid);
  assert.deepEqual(await workbench.request('remotes'), []);
});
