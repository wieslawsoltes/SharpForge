import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitAuthContext, scopedWritePermissions } from '../packages/git/src/auth/context.js';
import { createAuthOperations } from '../packages/git/src/auth/service.js';
import { personalAccessCredential } from '../packages/git/src/auth/pat.js';
import { GitPermissions, permissionStatus } from '../packages/git/src/permissions.js';
import { showGitAuthentication } from '../apps/studio/git-auth.js';
import { requestGitWriteConsent } from '../apps/studio/git-permissions.js';

// Hand-authored responses follow the primary API documents linked in the package auth contract.
const providers = [
  { provider: 'github', remote: 'https://github.com/acme/project', token: 'github_pat_fixture_token_for_unknown_permissions',
    path: '/repos/acme/project/pulls' },
  { provider: 'gitlab', remote: 'https://gitlab.example/acme/project', token: 'gitlab-pat-fixture-token',
    path: '/api/v4/projects/acme%2Fproject/merge_requests' },
  { provider: 'bitbucket', remote: 'https://bitbucket.org/acme/project', token: 'bitbucket-api-fixture-token',
    path: '/2.0/repositories/acme/project/pullrequests' },
  { provider: 'azure', remote: 'https://dev.azure.com/acme/Project/_git/Repo', token: 'azure-pat-fixture-token',
    path: '/acme/Project/_apis/git/repositories/Repo/pullrequests' },
  { provider: 'gitea', remote: 'https://gitea.example/acme/project', token: 'gitea-pat-fixture-token',
    path: '/api/v1/repos/acme/project/pulls' }
];

class Element extends EventTarget {
  constructor(tag, document) { super(); Object.assign(this, { tag, ownerDocument: document, children: [], value: '' }); }
  setAttribute(name, value) { this[name] = value; }
  append(...elements) { this.children.push(...elements); }
  prepend(...elements) { this.children.unshift(...elements); }
  showModal() { this.ownerDocument.onShow?.(this); }
  close() {}
  remove() { this.removed = true; }
  focus() {}
}

function fakeDocument() {
  const document = { elements: [], createElement(tag) {
    const element = new Element(tag, document);
    document.elements.push(element);
    return element;
  }, createTextNode(text) { return { textContent: text }; } };
  document.body = new Element('body', document);
  return document;
}

function descendants(element) { return [element, ...(element.children ?? []).flatMap(descendants)]; }
const click = element => element.dispatchEvent(new Event('click'));

async function setup(contract, { gitlabScopes = ['api'], githubScopes = '', giteaScopes, status = 201 } = {}) {
  const context = createGitAuthContext();
  const calls = [];
  const operations = createAuthOperations(context, { fetch: async (url, request) => {
    const path = new URL(url).pathname;
    calls.push({ path, request });
    if (path === '/user') return Response.json({ login: 'fixture', permissions: { admin: true } },
      { headers: { 'X-OAuth-Scopes': githubScopes, 'X-Accepted-GitHub-Permissions': 'pull_requests=write' } });
    if (path === '/api/v4/personal_access_tokens/self') return Response.json({ id: 7, revoked: false,
      active: true, scopes: gitlabScopes, name: 'Do not return token metadata', expires_at: null });
    if (path === '/api/v1/token') return giteaScopes ? Response.json({ id: 7, scopes: giteaScopes,
      user: { id: 1, login: 'fixture' } }) : Response.json({ message: 'Unknown route' }, { status: 404 });
    assert.equal(path, contract.path);
    assert.equal(request.method, 'POST');
    return Response.json({ number: 7, title: 'Feature', html_url: `${contract.remote}/pull/7` }, { status });
  } });
  const workbench = { request: (name, params, options = {}) => operations.find(value => value.name === name).run(null, params, options) };
  const document = fakeDocument();
  const signedIn = showGitAuthentication({ ...contract, document, remoteId: 'origin', credentialId: 'account',
    invoke: (method, params, options) => workbench.request('git.auth', { method, params }, options) });
  document.elements.find(element => element.type === 'password').value = contract.token;
  if (contract.provider === 'bitbucket') document.elements.find(element => element.type === 'text').value = 'user@example.com';
  click(document.elements.find(element => element.textContent === 'Sign in with token'));
  const account = await signedIn;
  assert.equal(account.scopeState, 'unknown');
  assert.deepEqual(account.scopes, []);
  assert.equal(JSON.stringify(account).includes(contract.token), false);
  return { context, calls, workbench, document };
}

for (const contract of providers) {
  test(`A25 ${contract.provider} PAT UI can review and submit one explicitly consented provider write`, async () => {
    const { context, calls, workbench, document } = await setup(contract);
    const params = { provider: contract.provider, remote: contract.remote, remoteId: 'origin', credentialId: 'account', operation: 'createPullRequest',
      input: { title: 'Feature', head: 'feature', base: 'main' } };
    await assert.rejects(workbench.request('git.provider', params), { code: 'Auth' });
    assert.equal(calls.length, 0);
    const shown = new Promise(resolve => { document.onShow = resolve; });
    const pending = requestGitWriteConsent(workbench, { ...params, operation: 'pullRequest', document });
    const dialog = await shown;
    const elements = descendants(dialog);
    const unknown = contract.provider !== 'gitlab';
    const button = elements.find(element => element.textContent === (unknown ? 'Attempt This Write' : 'Confirm Write'));
    if (unknown) {
      assert.equal(button.disabled, true);
      click(button);
      assert.equal(dialog.removed, undefined);
      const acknowledgment = elements.find(element => element.type === 'checkbox');
      acknowledgment.checked = true;
      acknowledgment.dispatchEvent(new Event('change'));
    }
    click(button);
    const consent = await pending;
    assert.deepEqual(consent, { remoteId: 'origin', scope: 'pullRequest', confirmed: true,
      ...(unknown ? { allowUnverified: true } : {}) });
    const created = await workbench.request('git.provider', { ...params, writeConsent: consent });
    assert.equal(created.id, 7);
    const writes = calls.filter(value => value.request.method === 'POST');
    assert.equal(writes.length, 1);
    const authorization = writes[0].request.headers.get('Authorization');
    assert.equal(authorization.startsWith(contract.provider === 'bitbucket' || contract.provider === 'azure' ? 'Basic ' : 'Bearer '), true);
    const stored = await context.vault.get('account');
    assert.equal(stored.scopeState, unknown ? 'unknown' : 'known');
    assert.equal(Object.hasOwn(stored, 'allowUnverified'), false);
    await assert.rejects(workbench.request('git.provider', params), { code: 'Auth' });
    await context.dispose();
  });
}

test('A25 actual read-only scope evidence blocks writes and the dialog lists missing permission alternatives', async () => {
  const contract = providers[1];
  const { context, calls, workbench, document } = await setup(contract, { gitlabScopes: ['read_api'] });
  const shown = new Promise(resolve => { document.onShow = resolve; });
  const pending = requestGitWriteConsent(workbench, { ...contract, remoteId: 'origin', credentialId: 'account', operation: 'push', document });
  const rejection = assert.rejects(pending, error => error.code === 'Auth' && error.details.state === 'known-insufficient');
  const dialog = await shown;
  const elements = descendants(dialog);
  assert.equal(elements.some(element => element.textContent?.includes('Write blocked. The token needs one of: api, write_repository')), true);
  assert.equal(elements.some(element => element.textContent === 'Attempt This Write'), false);
  click(elements.find(element => element.textContent === 'Close'));
  await rejection;
  const credential = await context.vault.get('account');
  await assert.rejects(scopedWritePermissions({ remoteId: 'origin', writeConsent: {
    remoteId: 'origin', scope: 'push', confirmed: true, allowUnverified: true
  } }).assertWrite(credential, 'push'), { code: 'Auth' });
  assert.equal(calls.every(value => value.request.method === 'GET'), true);
  await context.dispose();
});

test('A25 unknown permission acknowledgments cannot cross remotes, operations, or plain boolean confirmation', async () => {
  const credential = personalAccessCredential({ provider: 'gitea', token: 'unknown-gitea-token', allowedOrigins: ['https://gitea.example'] });
  assert.equal(permissionStatus(credential, 'push').state, 'unknown');
  await assert.rejects(new GitPermissions({ confirm: () => true }).assertWrite(credential, 'push'), { code: 'Auth' });
  for (const consent of [{ remoteId: 'other', scope: 'push' }, { remoteId: 'origin', scope: 'issue' }]) {
    await assert.rejects(scopedWritePermissions({ remoteId: 'origin', writeConsent: {
      ...consent, confirmed: true, allowUnverified: true
    } }).assertWrite(credential, 'push'), { code: 'Auth' });
  }
});

test('A25 GitHub classic scopes come from the actual response header and server rejection never grants unknown permissions', async () => {
  const classic = { ...providers[0], token: 'ghp_classic_fixture_token' };
  const known = await setup(classic, { githubScopes: 'repo, read:user' });
  const status = await known.workbench.request('git.auth', { method: 'inspectCredential', params: {
    credentialId: 'account', remoteId: 'origin', remote: classic.remote, operation: 'pullRequest'
  } });
  assert.equal(status.state, 'known-sufficient');
  assert.equal(status.scopeSource, 'oauth-header');
  assert.deepEqual(status.scopes, ['read:user', 'repo']);
  await known.context.dispose();
  const denied = await setup(providers[2], { status: 403 });
  await assert.rejects(denied.workbench.request('git.provider', { provider: providers[2].provider, remote: providers[2].remote,
    remoteId: 'origin', credentialId: 'account',
    operation: 'createPullRequest', input: { title: 'Feature', head: 'feature', base: 'main' },
    writeConsent: { remoteId: 'origin', scope: 'pullRequest', confirmed: true, allowUnverified: true }
  }), error => error.code === 'Auth' && error.details.status === 403);
  assert.equal((await denied.context.vault.get('account')).scopeState, 'unknown');
  assert.equal(denied.calls.length, 1);
  await denied.context.dispose();
});

test('A25 cancelling an unknown permission review returns no consent and never sends a mutation', async () => {
  const { context, calls, workbench, document } = await setup(providers[4]);
  const controller = new AbortController();
  const shown = new Promise(resolve => { document.onShow = resolve; });
  const pending = requestGitWriteConsent(workbench, { remote: providers[4].remote, remoteId: 'origin',
    credentialId: 'account', operation: 'pullRequest', document, signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'Cancelled' });
  const dialog = await shown;
  controller.abort();
  await rejected;
  assert.equal(dialog.removed, true);
  assert.equal(calls.every(value => value.request.method === 'GET'), true);
  await context.dispose();
});

test('A25 current Gitea token self-inspection records actual write and read-only scopes without account passwords', async () => {
  for (const scopes of [['write:repository'], ['read:repository']]) {
    const { context, calls, workbench } = await setup(providers[4], { giteaScopes: scopes });
    const status = await workbench.request('git.auth', { method: 'inspectCredential', params: {
      remote: providers[4].remote, remoteId: 'origin', credentialId: 'account', operation: 'push'
    } });
    assert.equal(status.state, scopes[0].startsWith('write:') ? 'known-sufficient' : 'known-insufficient');
    assert.equal(status.scopeSource, 'gitea-current-token');
    assert.deepEqual(status.scopes, scopes);
    assert.deepEqual(calls.map(value => value.path), ['/api/v1/token']);
    assert.equal(calls[0].request.headers.get('Authorization'), `Bearer ${providers[4].token}`);
    await context.dispose();
  }
});
