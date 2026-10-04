import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { GitOriginGrants, requiredGitOrigins } from '../packages/git/src/origins.js';
import { CredentialVault } from '../packages/git/src/auth/vault.js';
import { credentialAuthorization, personalAccessCredential } from '../packages/git/src/auth/pat.js';
import { GitPermissions, permissionStatus } from '../packages/git/src/permissions.js';
import { SecretRedactor } from '../packages/git/src/redact.js';
import { ProviderClient } from '../packages/git/src/providers/client.js';
import { createGitAuthContext, scopedWritePermissions } from '../packages/git/src/auth/context.js';

const apiOrigin = 'https://api.github.com';
const token = 'test-secret-unpredictable-value-41';
const credential = () => personalAccessCredential({ provider: 'github', token, allowedOrigins: [apiOrigin], scopes: ['repo'] });

function memoryEncryptedStore() {
  const records = new Map();
  let key;
  return {
    records, get key() { return key; },
    async get(id) { return records.get(id) ?? null; },
    async set(id, value) { records.set(id, structuredClone(value)); },
    async delete(id) { records.delete(id); },
    async list() { return [...records.keys()]; },
    async clear() { records.clear(); key = undefined; },
    async getOrCreateKey(candidate) { return key ??= candidate; }
  };
}

test('A25 GitHub origin proposals are exact and do not grant unrelated hosts', () => {
  assert.deepEqual(requiredGitOrigins('https://github.com/owner/repository.git'), ['https://api.github.com', 'https://github.com']);
  const grants = new GitOriginGrants();
  grants.grant('origin', requiredGitOrigins('https://github.com/owner/repository.git'));
  assert.equal(grants.assert(`${apiOrigin}/repos/owner/repository`, { remoteId: 'origin' }).origin, apiOrigin);
  const connect = grants.createCsp().split('; ').find(value => value.startsWith('connect-src'));
  assert.equal(connect, "connect-src 'self' https://api.github.com https://github.com");
  assert.throws(() => grants.assert('https://github.com.evil.example', { remoteId: 'origin' }), { code: 'Unsafe' });
  assert.throws(() => grants.grant('evil', ['https://github.com/path']), { code: 'Unsafe' });
  assert.throws(() => grants.grant('evil', ['https://*.example.com']), { code: 'Unsafe' });
  assert.throws(() => grants.assert('https://token@github.com', { remoteId: 'origin' }), { code: 'Unsafe' });
  grants.revoke('origin', apiOrigin);
  assert.throws(() => grants.assert(apiOrigin, { remoteId: 'origin' }), { code: 'Unsafe' });
});

test('A25 credentials have provider-correct schemes and exact recipient bindings', () => {
  const value = credential();
  assert.equal(credentialAuthorization(value, apiOrigin), `Bearer ${token}`);
  assert.equal(atob(credentialAuthorization(value, apiOrigin, { purpose: 'git' }).slice(6)), `x-access-token:${token}`);
  const azure = personalAccessCredential({ provider: 'azure', token, allowedOrigins: ['https://dev.azure.com'] });
  assert.equal(atob(credentialAuthorization(azure, 'https://dev.azure.com').slice(6)), `:${token}`);
  assert.equal(credentialAuthorization({ ...azure, kind: 'oauth' }, 'https://dev.azure.com'), `Bearer ${token}`);
  assert.equal(credentialAuthorization({ ...azure, kind: 'oauth' }, 'https://dev.azure.com', { purpose: 'git' }), `Bearer ${token}`);
  assert.equal(atob(credentialAuthorization(azure, 'https://dev.azure.com', { purpose: 'git' }).slice(6)), `:${token}`);
  assert.throws(() => credentialAuthorization(value, 'https://github.com'), { code: 'Auth' });
  assert.throws(() => credentialAuthorization({ ...value, accessToken: 'bad\nheader' }, apiOrigin), { code: 'Auth' });
});

test('A25 session vaults are isolated and metadata/JSON do not expose secrets', async () => {
  const vault = new CredentialVault();
  await vault.set('account', credential());
  assert.equal((await vault.get('account', { origin: apiOrigin })).accessToken, token);
  assert.equal(await new CredentialVault().get('account'), null);
  assert.equal(JSON.stringify(await vault.list()).includes(token), false);
  assert.equal(JSON.stringify(vault).includes(token), false);
  await assert.rejects(vault.get('account', { origin: 'https://other.example' }), { code: 'Auth' });
  await vault.dispose();
  await assert.rejects(vault.get('account'), { code: 'Disposed' });
});

test('A25 opt-in persistent vault contains only authenticated ciphertext and non-extractable key', async () => {
  const store = memoryEncryptedStore();
  const vault = new CredentialVault({ store, crypto: webcrypto });
  await vault.set('account', credential());
  await assert.rejects(vault.enablePersistence(), { code: 'Auth' });
  await vault.enablePersistence({ consent: true });
  assert.equal(vault.mode, 'encrypted');
  assert.equal(store.key.extractable, false);
  assert.equal(JSON.stringify([...store.records]).includes(token), false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', store.key));
  const reloaded = new CredentialVault({ store, crypto: webcrypto });
  await reloaded.enablePersistence({ consent: true });
  assert.equal((await reloaded.get('account')).accessToken, token);
  const ciphertext = store.records.get('account');
  const corrupt = new Uint8Array(ciphertext.ciphertext);
  corrupt[0] ^= 1;
  store.records.set('account', { ...ciphertext, ciphertext: corrupt.buffer });
  await assert.rejects(reloaded.get('account'), { code: 'Auth' });
});

test('A25 limits, per-id AAD, and opt-out clear persistent values', async () => {
  const store = memoryEncryptedStore();
  const vault = new CredentialVault({ store, crypto: webcrypto, maximumCredentials: 1 });
  await vault.enablePersistence({ consent: true });
  await vault.set('account', credential());
  await assert.rejects(vault.set('overflow', credential()), { code: 'Limit' });
  store.records.set('renamed', store.records.get('account'));
  await assert.rejects(vault.get('renamed'), { code: 'Auth' });
  store.records.delete('renamed');
  await vault.disablePersistence();
  assert.equal(vault.mode, 'session');
  assert.equal(store.records.size, 0);
  assert.equal((await vault.get('account')).accessToken, token);
});

test('A25 read-only credentials fail before a write or confirmation', async () => {
  const grants = new GitOriginGrants({ grants: { origin: [apiOrigin] } });
  let requests = 0;
  let confirms = 0;
  const permissions = new GitPermissions({ confirm: () => { confirms++; return true; } });
  const client = new ProviderClient({ baseUrl: apiOrigin, grants, remoteId: 'origin',
    credentialProvider: () => ({ ...credential(), scopes: ['read:user'] }), permissions,
    fetch: async () => { requests++; return Response.json({}); } });
  await assert.rejects(client.json('repos/o/r/pulls', { method: 'POST', body: {}, operation: 'pullRequest' }), error => {
    assert.equal(error.code, 'Auth');
    assert.equal(error.details.missingScopes.includes('repo'), true);
    return true;
  });
  assert.equal(requests, 0);
  assert.equal(confirms, 0);
  assert.equal(permissionStatus({ ...credential(), scopes: [], permissions: { contents: 'write' } }, 'push').allowed, true);
});

test('A25 provider captures token only in Authorization, never URL/body/diagnostic', async () => {
  const grants = new GitOriginGrants({ grants: { origin: [apiOrigin] } });
  let capture;
  const client = new ProviderClient({ baseUrl: apiOrigin, grants, remoteId: 'origin', credentialProvider: credential,
    fetch: async (url, request) => { capture = { url, request }; return Response.json({ error: token }, { status: 401 }); } });
  await assert.rejects(client.json('user'), error => !JSON.stringify(error).includes(token));
  assert.equal(capture.request.headers.get('Authorization'), `Bearer ${token}`);
  assert.equal(capture.url.includes(token), false);
  assert.equal(String(capture.request.body).includes(token), false);
  assert.equal(capture.request.redirect, 'error');
  assert.equal(capture.request.credentials, 'omit');
});

test('A25 request consent binds both remote and operation, auth RPC replies stay metadata-only', async () => {
  const context = createGitAuthContext();
  const result = await context.invoke('setCredential', { id: 'account', credential: credential(), remoteId: 'origin',
    origins: [apiOrigin], grantConsent: true });
  assert.equal(JSON.stringify(result).includes(token), false);
  const denied = scopedWritePermissions({ remoteId: 'other', writeConsent: { remoteId: 'origin', scope: 'push', confirmed: true } });
  await assert.rejects(denied.assertWrite(credential(), 'push'), { code: 'Auth' });
  const allowed = scopedWritePermissions({ remoteId: 'origin', writeConsent: { remoteId: 'origin', scope: 'push', confirmed: true } });
  await allowed.assertWrite(credential(), 'push');
  await assert.rejects(allowed.assertWrite(credential(), 'issue'), { code: 'Auth' });
  await context.invoke('logout', { id: 'account' });
  assert.deepEqual(await context.invoke('listCredentials'), []);
});

test('A25 redaction handles token variants, credential URLs, JSON secrets and bounded traversal', () => {
  const redactor = new SecretRedactor();
  redactor.registerCredential(credential());
  const value = redactor.value({ access_token: 'unknown', remote: `https://user:${token}@github.com/o/r`,
    message: `Authorization: Bearer ${token}`, nested: { message: encodeURIComponent(token) } });
  assert.equal(JSON.stringify(value).includes(token), false);
  assert.equal(value.remote, 'https://github.com/o/r');
  assert.equal(value.access_token, '[REDACTED]');
  assert.throws(() => redactor.assertSafeBytes(new TextEncoder().encode(token)), { code: 'Unsafe' });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => redactor.value(cycle), { code: 'Unsafe' });
});

test('A25 proxy connection grants never imply credential forwarding consent', async () => {
  const context = createGitAuthContext();
  await context.invoke('setCredential', { id: 'account', credential: credential(), remoteId: 'origin',
    origins: [apiOrigin, 'https://proxy.example'], grantConsent: true });
  const direct = await context.transportOptions({ remoteId: 'origin', credentialId: 'account' });
  await direct.requireOrigin('https://proxy.example', { purpose: 'git-proxy' });
  await assert.rejects(direct.requireOrigin('https://proxy.example', { credentials: true, purpose: 'git-proxy-credentials' }), { code: 'Auth' });
  await assert.rejects(direct.requireOrigin('https://proxy.example', { credentials: true, purpose: 'git-credentials' }), { code: 'Auth' });
  const forwarded = await context.transportOptions({ remoteId: 'origin', credentialId: 'account',
    credentialForwardOrigins: ['https://proxy.example'], credentialForwardConsent: true });
  await forwarded.requireOrigin('https://proxy.example', { credentials: true, purpose: 'git-proxy-credentials' });
  assert.deepEqual((await context.vault.get('account')).allowedOrigins, [apiOrigin]);
  assert.equal((await context.transportOptions({ remoteId: 'origin' })).credentialProvider, undefined);
  await context.dispose();
});

test('A25 redaction registrations are independently disposable for accounts sharing a token', () => {
  const redactor = new SecretRedactor();
  const first = redactor.register(token);
  const second = redactor.register(token);
  first(); first();
  assert.equal(redactor.text(token), '[REDACTED]');
  second();
  assert.equal(redactor.text(token), token);
});

test('A25 separately authorized LFS action credentials never widen primary credential bindings', async () => {
  const context = createGitAuthContext();
  await context.invoke('grant', { remoteId: 'origin', origins: ['https://objects.example'], consent: true });
  const denied = await context.transportOptions({ remoteId: 'origin' });
  await assert.rejects(denied.requireOrigin('https://objects.example', {
    credentials: true, purpose: 'git-lfs-action-credentials'
  }), { code: 'Auth' });
  const allowed = await context.transportOptions({ remoteId: 'origin', actionCredentialOrigins: ['https://objects.example'],
    actionCredentialConsent: true });
  await allowed.requireOrigin('https://objects.example', { credentials: true, purpose: 'git-lfs-action-credentials' });
  await assert.rejects(allowed.requireOrigin('https://objects.example', { credentials: true, purpose: 'git-credentials' }), { code: 'Auth' });
  assert.equal(allowed.credentialProvider, undefined);
  await context.dispose();
});
