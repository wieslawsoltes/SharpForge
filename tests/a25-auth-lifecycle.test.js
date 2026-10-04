import test from 'node:test';
import assert from 'node:assert/strict';
import { CredentialVault } from '../packages/git/src/auth/vault.js';
import { CredentialLifecycle } from '../packages/git/src/auth/lifecycle.js';
import { permissionStatus } from '../packages/git/src/permissions.js';

const initial = { provider: 'github', kind: 'oauth', accessToken: 'scope-access', refreshToken: 'scope-refresh',
  allowedOrigins: ['https://api.github.com'], scopes: ['read:user'] };

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

test('A25 logout waits for a scope persistence operation and prevents credential resurrection', async () => {
  const vault = new CredentialVault();
  await vault.set('account', initial);
  const entered = deferred();
  const release = deferred();
  const lifecycle = new CredentialLifecycle({ vault: {
    get: (...args) => vault.get(...args), delete: (...args) => vault.delete(...args),
    async set(id, record) { entered.resolve(); await release.promise; return vault.set(id, record); }
  } });
  const sessionSignal = lifecycle.signalFor('account');
  const update = lifecycle.observeScopes('account', ['repo'], { sessionSignal, accessToken: initial.accessToken });
  await entered.promise;
  const rejected = assert.rejects(update, { code: 'Cancelled' });
  const logout = lifecycle.logout('account');
  assert.equal(sessionSignal.aborted, true);
  release.resolve();
  await Promise.all([rejected, logout]);
  assert.equal(await vault.get('account'), null);
  assert.equal(await lifecycle.observeScopes('account', ['repo'], { sessionSignal, accessToken: initial.accessToken }), false);
});

test('A25 old requests cannot attach broad scopes to a refreshed or replacement credential', async () => {
  const vault = new CredentialVault();
  await vault.set('account', initial);
  const lifecycle = new CredentialLifecycle({ vault, now: () => 1000 });
  lifecycle.registerProvider('github', { refresh: async () => ({ accessToken: 'replacement-access',
    scopes: ['read:user'], expiresAt: 3601000 }) });
  const sessionSignal = lifecycle.signalFor('account');
  await lifecycle.credential('account', { forceRefresh: true });
  assert.equal(await lifecycle.observeScopes('account', ['repo'], { sessionSignal, accessToken: initial.accessToken }), false);
  assert.deepEqual((await vault.get('account')).scopes, ['read:user']);
  await lifecycle.logout('account');
  await vault.set('account', { ...initial, accessToken: 'another-account-token' });
  lifecycle.signalFor('account');
  assert.equal(await lifecycle.observeScopes('account', ['repo'], { sessionSignal, accessToken: 'another-account-token' }), false);
  assert.deepEqual((await vault.get('account')).scopes, ['read:user']);
});

test('A25 Azure permission checks honor documented inheritance and only its exact Entra resource', () => {
  const credential = { provider: 'azure', kind: 'oauth' };
  for (const scope of ['vso.code_write', 'vso.code_manage', 'vso.code_full', 'user_impersonation',
    '499b84ac-1321-427f-aa17-267ca6975798/user_impersonation', 'https://app.vssps.visualstudio.com/user_impersonation']) {
    assert.equal(permissionStatus({ ...credential, scopes: [scope] }, 'push').allowed, true, scope);
  }
  assert.equal(permissionStatus({ ...credential, scopes: ['vso.work_full'] }, 'issue').allowed, true);
  for (const scope of ['vso.code', '.default', '499b84ac-1321-427f-aa17-267ca6975798/.default',
    'https://evil.example/user_impersonation']) {
    assert.equal(permissionStatus({ ...credential, scopes: [scope] }, 'push').allowed, false, scope);
  }
  assert.equal(permissionStatus({ provider: 'azure', kind: 'pat', scopes: ['user_impersonation'] }, 'push').allowed, false);
});
