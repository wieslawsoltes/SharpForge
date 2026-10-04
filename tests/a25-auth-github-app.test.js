import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubAppSession } from '../packages/git/src/auth/github-app.js';
import { CredentialLifecycle } from '../packages/git/src/auth/lifecycle.js';
import { CredentialVault } from '../packages/git/src/auth/vault.js';
import { ProviderClient } from '../packages/git/src/providers/client.js';
import { GitOriginGrants } from '../packages/git/src/origins.js';

async function appSession(fetch) {
  const vault = new CredentialVault();
  await vault.set('app', { provider: 'github', kind: 'oauth', accessToken: 'app-user-token', refreshToken: 'app-refresh-token',
    expiresAt: 1000000, allowedOrigins: ['https://api.github.com'] });
  const lifecycle = new CredentialLifecycle({ vault, now: () => 1000 });
  let refreshes = 0;
  lifecycle.registerProvider('github', { refresh: async () => {
    refreshes++;
    return { accessToken: 'renewed-app-token', expiresAt: 2000000 };
  } });
  const client = new ProviderClient({ baseUrl: 'https://api.github.com', remoteId: 'origin',
    grants: new GitOriginGrants({ grants: { origin: ['https://api.github.com'] } }),
    credentialProvider: () => lifecycle.credential('app'), fetch });
  return { session: new GitHubAppSession({ client, lifecycle, credentialId: 'app' }), refreshes: () => refreshes };
}

test('A25 GitHub App installation request refreshes a rejected user token once and retries once', async () => {
  const captures = [];
  const { session, refreshes } = await appSession(async (url, request) => {
    if (new URL(url).pathname === '/user/installations') return Response.json({ installations: [
      { id: 42, suspended_at: null, account: { login: 'acme' }, repository_selection: 'selected' }
    ] });
    captures.push(request.headers.get('Authorization'));
    if (captures.length === 1) return Response.json({ message: 'Rejected user token' }, { status: 401 });
    return Response.json({ repositories: [{ id: 17, full_name: 'acme/project' }] });
  });
  assert.equal((await session.selectInstallation(42)).account, 'acme');
  assert.equal((await session.listRepositories())[0].full_name, 'acme/project');
  assert.deepEqual(captures, ['Bearer app-user-token', 'Bearer renewed-app-token']);
  assert.equal(refreshes(), 1);
  await session.logout();
});

test('A25 suspended and revoked GitHub App installations fail with Auth', async () => {
  let suspended = true;
  const { session } = await appSession(async url => new URL(url).pathname === '/user/installations' ? Response.json({ installations: [
    { id: 42, suspended_at: suspended ? '2026-01-01T00:00:00Z' : null }
  ] }) : Response.json({ message: 'Installation unavailable' }, { status: 404 }));
  await assert.rejects(session.selectInstallation(42), { code: 'Auth' });
  suspended = false;
  await session.selectInstallation(42);
  await assert.rejects(session.listRepositories(), { code: 'Auth' });
  await session.logout();
});
