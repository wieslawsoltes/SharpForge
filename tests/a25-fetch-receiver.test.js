import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpGitTransport } from '../packages/git/src/transport/http.js';
import { ProviderClient } from '../packages/git/src/providers/client.js';
import { GitOriginGrants } from '../packages/git/src/origins.js';
import { oauthRequest } from '../packages/git/src/auth/oauth-http.js';

const origin = 'https://git.example';

function standaloneFetch(respond) {
  const calls = [];
  // An arrow mock hides the receiver defect that native Window/WorkerGlobalScope fetch rejects.
  async function fetch(url, options) {
    assert.equal(this, undefined, 'a standalone fetch must not receive its transport or provider client as this');
    calls.push({ url, options });
    return respond(calls.length, url, options);
  }
  return { calls, fetch };
}

for (const injected of [false, true]) {
  const source = injected ? 'injected' : 'default global';
  test(`A25 HTTP invokes ${source} fetch as a standalone function after its origin grant`, async context => {
    const fixture = standaloneFetch(() => new Response('native receiver fixture'));
    if (!injected) context.mock.method(globalThis, 'fetch', fixture.fetch);
    const options = injected ? { fetch: fixture.fetch } : {};
    const denied = new HttpGitTransport(options);
    await assert.rejects(denied.request({ url: `${origin}/repository.git/info/refs` }), { code: 'Auth' });
    assert.equal(fixture.calls.length, 0);
    const transport = new HttpGitTransport({ ...options, origins: [origin], credentialOrigins: [origin] });
    const response = await transport.request({ url: `${origin}/repository.git/info/refs` });
    assert.equal(await response.text(), 'native receiver fixture');
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].options.credentials, 'omit');
    assert.equal(fixture.calls[0].options.redirect, 'error');
    const action = await transport.request({ url: `${origin}/lfs-object`, credentialProvider: null,
      credentialPurpose: 'git-lfs-action-credentials', useProxy: false, headers: { Authorization: 'Bearer fixture-action' } });
    assert.equal(await action.text(), 'native receiver fixture');
    assert.equal(fixture.calls[1].options.headers.get('authorization'), 'Bearer fixture-action');
  });

  test(`A25 provider invokes ${source} fetch without a client receiver across retries`, async context => {
    const fixture = standaloneFetch(count => count === 1
      ? Response.json({}, { status: 429, headers: { 'Retry-After': '0' } }) : Response.json({ id: 7 }));
    if (!injected) context.mock.method(globalThis, 'fetch', fixture.fetch);
    const provider = new ProviderClient({ baseUrl: `${origin}/api/`, remoteId: 'repository',
      grants: new GitOriginGrants({ grants: { repository: [origin] } }), delay: async () => {},
      ...(injected ? { fetch: fixture.fetch } : {}) });
    try {
      assert.deepEqual(await provider.json('issues/7'), { id: 7 });
      assert.equal(fixture.calls.length, 2);
      assert.ok(fixture.calls.every(call => call.options.credentials === 'omit' && call.options.redirect === 'error'));
    } finally { provider.dispose(); }
  });
}

test('A25 OAuth already preserves the standalone fetch contract and explicit grant boundary', async () => {
  const fixture = standaloneFetch(() => Response.json({ access_token: 'local-fixture-token' }));
  const origins = [];
  const result = await oauthRequest(`${origin}/oauth/token`, { code: 'local-fixture-code' }, {
    fetch: fixture.fetch, assertOrigin: url => { origins.push(new URL(url).origin); }
  });
  assert.equal(result.access_token, 'local-fixture-token');
  assert.deepEqual(origins, [origin]);
  assert.equal(fixture.calls.length, 1);
});
