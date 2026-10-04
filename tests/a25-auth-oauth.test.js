import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { OAuthDeviceFlow } from '../packages/git/src/auth/device-flow.js';
import { OAuthPkceFlow, pkceChallenge } from '../packages/git/src/auth/pkce.js';
import { supportedAuthenticationFlows, OAuthTokenBroker } from '../packages/git/src/auth/broker.js';
import { createTokenBroker } from '../packages/git/broker/token-broker.js';
import { CredentialVault } from '../packages/git/src/auth/vault.js';
import { CredentialLifecycle } from '../packages/git/src/auth/lifecycle.js';
import { createGitAuthContext } from '../packages/git/src/auth/context.js';

const clientId = 'test-client';
const origins = ['https://github.com', 'https://api.github.com'];
const assertOrigin = input => { assert.equal(origins.includes(new URL(input).origin), true); };

function device(responses, extra = {}) {
  let clock = 0;
  const intervals = [];
  const flow = new OAuthDeviceFlow({ provider: 'github', clientId, allowedOrigins: origins, assertOrigin,
    now: () => clock, delay: async (milliseconds, signal) => {
      assert.equal(signal.aborted, false); intervals.push(milliseconds); clock += milliseconds;
    }, fetch: async (_, request) => {
      const fields = new URLSearchParams(request.body);
      if (!fields.has('grant_type')) return Response.json({ device_code: 'device-secret', user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      assert.equal(fields.get('client_secret'), null);
      return Response.json(responses.shift());
    }, ...extra });
  return { flow, intervals };
}

test('A25 device flow obeys pending, slow_down interval and token expiry fields', async () => {
  const { flow, intervals } = device([{ error: 'authorization_pending' }, { error: 'slow_down' },
    { access_token: 'device-access-token', token_type: 'bearer', scope: 'repo', expires_in: 3600 }]);
  let displayed;
  const result = await flow.authorize({ onCode: value => { displayed = value; } });
  assert.deepEqual(intervals, [5000, 5000, 10000]);
  assert.equal(result.accessToken, 'device-access-token');
  assert.equal(result.expiresAt, 3620000);
  assert.equal(JSON.stringify(displayed).includes('device-secret'), false);
  assert.equal(JSON.stringify(flow).includes('device-secret'), false);
});

test('A25 device flow rejects denied/expired and aborts in-flight polls', async () => {
  for (const error of ['access_denied', 'expired_token']) {
    await assert.rejects(device([{ error }]).flow.authorize(), { code: 'Auth' });
  }
  const controller = new AbortController();
  let requests = 0;
  const { flow } = device([], { delay: async () => controller.abort(), fetch: async () => {
    requests++;
    return Response.json({ device_code: 'device-secret', user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
  } });
  await assert.rejects(flow.authorize({ signal: controller.signal }), { code: 'Cancelled' });
  assert.equal(requests, 1);
});

test('A25 PKCE S256 matches RFC 7636 Appendix B', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', webcrypto),
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  await assert.rejects(pkceChallenge('short', webcrypto), { code: 'Auth' });
});

function pkce(extra = {}) {
  let last;
  const flow = new OAuthPkceFlow({ provider: 'gitlab', crypto: webcrypto, now: () => 1000,
    authorizeUrl: 'https://gitlab.com/oauth/authorize', tokenUrl: 'https://gitlab.com/oauth/token',
    redirectUri: 'https://ide.example/git-oauth-callback.html', clientId, scopes: ['api'], allowedOrigins: ['https://gitlab.com'],
    assertOrigin: url => assert.equal(new URL(url).origin, 'https://gitlab.com'), fetch: async (_, request) => {
      last = new URLSearchParams(request.body);
      return Response.json({ access_token: 'pkce-access-token', token_type: 'Bearer', scope: 'api' });
    }, ...extra });
  return { flow, fields: () => last };
}

test('A25 PKCE rejects wrong state/origin and consumes successful authorization codes once', async () => {
  const { flow, fields } = pkce();
  const request = await flow.start();
  const authorize = new URL(request.authorizationUrl);
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.has('code_verifier'), false);
  await assert.rejects(flow.complete('https://ide.example/git-oauth-callback.html?state=wrong&code=secret'), { code: 'Auth' });
  const callback = `https://ide.example/git-oauth-callback.html?state=${request.state}&code=one-use-code`;
  const result = await flow.complete(callback);
  assert.equal(result.accessToken, 'pkce-access-token');
  assert.equal(fields().get('code'), 'one-use-code');
  assert.equal(await pkceChallenge(fields().get('code_verifier'), webcrypto), authorize.searchParams.get('code_challenge'));
  await assert.rejects(flow.complete(callback), { code: 'Auth' });
  assert.equal(JSON.stringify(flow).includes('one-use-code'), false);
  const next = await flow.start();
  await assert.rejects(flow.complete(`https://evil.example/git-oauth-callback.html?state=${next.state}&code=secret`), { code: 'Auth' });
});

test('A25 OIDC flows require verified matching nonce and expired transactions cannot exchange', async () => {
  const { flow } = pkce({ scopes: ['openid'] });
  const transaction = await flow.start();
  await assert.rejects(flow.complete(`https://ide.example/git-oauth-callback.html?state=${transaction.state}&code=code`), { code: 'Auth' });
  let clock = 1;
  const expiring = pkce({ now: () => clock, lifetimeMs: 10 }).flow;
  const request = await expiring.start();
  clock = 20;
  await assert.rejects(expiring.complete(`https://ide.example/git-oauth-callback.html?state=${request.state}&code=code`), { code: 'Auth' });
});

test('A25 broker exchanges a state/challenge-bound transaction without exposing server secret', async () => {
  let upstream;
  const handler = createTokenBroker({ allowedAppOrigins: ['https://ide.example'], crypto: webcrypto,
    providers: { github: { clientId, clientSecret: 'server-secret-only', tokenUrl: 'https://github.com/login/oauth/access_token',
      redirectUris: ['https://ide.example/git-oauth-callback.html'] } }, fetch: async (url, request) => {
      upstream = { url, fields: new URLSearchParams(request.body) };
      return Response.json({ access_token: 'broker-access-token', token_type: 'bearer', client_secret: 'never-return' });
    } });
  const captures = [];
  const broker = new OAuthTokenBroker({ origin: 'https://broker.example', provider: 'github',
    assertOrigin: () => {}, fetch: async (url, request) => {
      captures.push(request.body);
      return handler(new Request(url, { ...request, headers: { ...request.headers, Origin: 'https://ide.example' } }));
    } });
  const verifier = 'A'.repeat(43);
  const state = 'B'.repeat(43);
  const transactionId = await broker.begin({ state, codeChallenge: await pkceChallenge(verifier, webcrypto),
    redirectUri: 'https://ide.example/git-oauth-callback.html' });
  const result = await broker.exchange({ transactionId, state, code: 'secret-code', codeVerifier: verifier });
  assert.equal(result.access_token, 'broker-access-token');
  assert.equal(result.client_secret, undefined);
  assert.equal(upstream.fields.get('client_secret'), 'server-secret-only');
  assert.equal(captures.join('').includes('server-secret-only'), false);
  assert.equal((await broker.exchange({ transactionId, state, code: 'secret-code', codeVerifier: verifier })).error,
    'broker_request_rejected');
  const denied = await handler(new Request('https://broker.example/oauth/begin', {
    method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}'
  }));
  assert.equal(denied.status, 403);
});

test('A25 authentication offers GitHub web flow only with an exchange broker', () => {
  assert.deepEqual(supportedAuthenticationFlows({ provider: 'github' }), ['pat', 'device']);
  assert.deepEqual(supportedAuthenticationFlows({ provider: 'github', brokerOrigin: 'https://broker.example' }), ['pat', 'device', 'pkce']);
});

test('A25 expired tokens refresh once across concurrent jobs; logout aborts jobs and revokes once', async () => {
  const vault = new CredentialVault();
  await vault.set('account', { provider: 'github', accessToken: 'expired-token', refreshToken: 'refresh-secret',
    allowedOrigins: origins, expiresAt: 1, scopes: ['repo'] });
  const lifecycle = new CredentialLifecycle({ vault, now: () => 100 });
  let refreshed = 0;
  let revoked = 0;
  lifecycle.registerProvider('github', {
    async refresh() { refreshed++; return { accessToken: 'fresh-token', expiresAt: 1000000 }; },
    async revoke() { revoked++; }
  });
  const values = await Promise.all([lifecycle.credential('account'), lifecycle.credential('account')]);
  assert.equal(refreshed, 1);
  assert.equal(values[0].accessToken, 'fresh-token');
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  const job = lifecycle.run('account', (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    started();
  }));
  await pending;
  const rejected = assert.rejects(job, { code: 'Cancelled' });
  await Promise.all([lifecycle.logout('account'), lifecycle.logout('account')]);
  await rejected;
  assert.equal(revoked, 1);
  assert.equal(await vault.get('account'), null);
});

test('A25 configured OAuth credentials refresh and revoke through the worker with exact recipient binding', async () => {
  const requests = [];
  const context = createGitAuthContext({ now: () => 100000, fetch: async (url, request) => {
    const fields = new URLSearchParams(request.body);
    requests.push({ url, fields });
    if (url.endsWith('/oauth/revoke')) return Response.json({});
    return Response.json({ access_token: 'rotated-access', token_type: 'bearer', expires_in: 3600 });
  } });
  await context.invoke('setCredential', { id: 'account', remoteId: 'gitlab', origins: ['https://gitlab.example'], grantConsent: true,
    credential: { provider: 'gitlab', kind: 'oauth', accessToken: 'old-access', refreshToken: 'refresh-secret', expiresAt: 1,
      allowedOrigins: ['https://gitlab.example'], scopes: ['api'], oauth: { remote: 'https://gitlab.example/acme/project',
        remoteId: 'gitlab', clientId: 'public-client' } } });
  const current = await context.lifecycle.credential('account');
  assert.equal(current.accessToken, 'rotated-access');
  assert.equal(current.refreshToken, 'refresh-secret');
  assert.deepEqual(current.scopes, ['api']);
  assert.equal(requests[0].fields.has('client_secret'), false);
  assert.equal(context.redactor.text('old-access rotated-access'), '[REDACTED] [REDACTED]');
  const result = await context.invoke('logout', { id: 'account' });
  assert.equal(result.remoteRevoked, true);
  assert.equal(requests.filter(value => value.url.endsWith('/oauth/revoke')).length, 1);
  assert.equal(requests.at(-1).fields.get('token'), 'rotated-access');
});

test('A25 device broker preserves polling states and never sends its secret in a device request', async () => {
  let polls = 0;
  let clock = 0;
  const handler = createTokenBroker({ allowedAppOrigins: ['https://ide.example'], crypto: webcrypto,
    providers: { github: { clientId, clientSecret: 'server-device-secret', tokenUrl: 'https://github.com/login/oauth/access_token',
      redirectUris: ['https://ide.example/git-oauth-callback.html'] } }, fetch: async (url, request) => {
      const fields = new URLSearchParams(request.body);
      assert.equal(fields.has('client_secret'), false);
      if (url.endsWith('/device/code')) return Response.json({ device_code: 'private-device', user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (++polls === 1) return Response.json({ error: 'authorization_pending' }, { status: 400 });
      return Response.json({ access_token: 'broker-device-access', token_type: 'bearer' });
    } });
  const broker = new OAuthTokenBroker({ provider: 'github', origin: 'https://broker.example', assertOrigin: () => {},
    fetch: (url, request) => handler(new Request(url, { ...request, headers: { ...request.headers, Origin: 'https://ide.example' } })) });
  const flow = new OAuthDeviceFlow({ provider: 'github', clientId, broker, allowedOrigins: origins, assertOrigin,
    now: () => clock, delay: async value => { clock += value; } });
  assert.equal((await flow.authorize()).accessToken, 'broker-device-access');
  assert.equal(polls, 2);
});
