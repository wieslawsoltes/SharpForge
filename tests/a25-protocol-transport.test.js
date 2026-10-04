import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpGitTransport } from '../packages/git/src/transport/http.js';
import { createGitProxy } from '../packages/git/proxy/server.js';
import { RestGitTransport } from '../packages/git/src/transport/rest.js';
import { hashObject } from '../packages/git/src/hash.js';

const bytes = new TextEncoder().encode('transport fixture');

test('HTTP requires separate remote/proxy/credential grants and records the actual credential recipient', async () => {
  const calls = [];
  const audits = [];
  const fetch = async (url, options) => { calls.push({ url, options }); return new Response(bytes); };
  const denied = new HttpGitTransport({ fetch });
  await assert.rejects(denied.request({ url: 'https://git.test/r.git/info/refs?service=git-upload-pack' }), { code: 'Auth' });
  assert.equal(calls.length, 0);
  const options = { fetch, proxyUrl: 'https://proxy.test/git', origins: ['https://git.test', 'https://proxy.test'],
    credentialProvider: async () => ({ headers: { Authorization: 'Bearer private-fixture-token' } }), onCredentialOrigin: audit => audits.push(audit) };
  const noConsent = new HttpGitTransport({ ...options, credentialOrigins: ['https://git.test'] });
  await assert.rejects(noConsent.request({ url: 'https://git.test/r.git/git-upload-pack' }), { code: 'Auth' });
  assert.equal(calls.length, 0);
  const transport = new HttpGitTransport({ ...options, credentialOrigins: ['https://git.test', 'https://proxy.test'] });
  const response = await transport.request({ url: 'https://git.test/r.git/git-upload-pack', method: 'POST', body: bytes });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  assert.equal(calls[0].options.headers.get('authorization'), 'Bearer private-fixture-token');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.deepEqual(audits, [{ origin: 'https://proxy.test', upstreamOrigin: 'https://git.test', viaProxy: true }]);
  await assert.rejects(transport.request({ url: 'https://user:secret@git.test/r' }), { code: 'Unsafe' });
});

test('HTTP CORS errors identify origin without retaining transport secrets', async () => {
  const transport = new HttpGitTransport({ origins: ['https://git.test'], fetch: async () => { throw new TypeError('private secret'); } });
  await assert.rejects(transport.request({ url: 'https://git.test/r.git' }), error => {
    assert.equal(error.code, 'Network');
    assert.equal(error.details.requiredOriginGrant, 'https://git.test');
    assert.ok(!JSON.stringify(error).includes('private secret'));
    return true;
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.request({ url: 'https://git.test/r.git', signal: controller.signal }), { code: 'Cancelled' });
});

test('LFS action credentials use a distinct recipient grant and never mix with repository credentials', async () => {
  const grants = [];
  let providerCalls = 0;
  let observedScopes = 0;
  const transport = new HttpGitTransport({
    requireOrigin: async (origin, context) => { grants.push({ origin, ...context }); return true; },
    credentialProvider: async () => { providerCalls++; return { headers: { Authorization: 'Bearer repository' } }; },
    onScopes: async () => { observedScopes++; },
    fetch: async (url, options) => {
      assert.equal(options.headers.get('authorization'), 'Bearer storage-action');
      return new Response(bytes, { headers: { 'X-OAuth-Scopes': 'repo, admin:org' } });
    }
  });
  const action = { url: 'https://storage.test/object', headers: { Authorization: 'Bearer storage-action' },
    credentialPurpose: 'git-lfs-action-credentials', useProxy: false };
  await assert.rejects(transport.request(action), { code: 'Unsafe' });
  const response = await transport.request({ ...action, credentialProvider: null });
  await response.arrayBuffer();
  assert.equal(providerCalls, 0);
  assert.equal(observedScopes, 0, 'an LFS action host cannot assert repository-token permissions');
  assert.deepEqual(grants, [
    { origin: 'https://storage.test', credentials: false, purpose: 'git-remote' },
    { origin: 'https://storage.test', credentials: true, purpose: 'git-lfs-action-credentials' }
  ]);
  await assert.rejects(transport.request({ ...action, credentialProvider: null, useProxy: true }), { code: 'Unsafe' });
});

test('observed scopes are awaited only for authenticated repository requests with an actual header', async () => {
  const scopes = [];
  let request = 0;
  const transport = new HttpGitTransport({ origins: ['https://git.test'], credentialOrigins: ['https://git.test'],
    credentialProvider: async () => ({ headers: { Authorization: 'Bearer repository-fixture' } }),
    onScopes: async value => { await Promise.resolve(); scopes.push(value); },
    fetch: async () => new Response(bytes, { headers: request++ ? {} : { 'X-OAuth-Scopes': 'repo, read:user  gist' } }) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await transport.request({ url: 'https://git.test/r.git/info/refs?service=git-upload-pack' });
    assert.equal(scopes.length, 1);
    await response.arrayBuffer();
  }
  assert.deepEqual(scopes, [['repo', 'read:user', 'gist']]);
});

test('reference proxy restricts client/upstream origins, paths, methods and request headers', async () => {
  const calls = [];
  const proxy = createGitProxy({ upstreamOrigins: ['https://git.test'], clientOrigins: ['https://studio.test'],
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(bytes, { headers: { 'Content-Type': 'application/x-git-upload-pack-result' } }); } });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${proxy.address().port}/git`;
  const invoke = (url, options = {}) => fetch(`${endpoint}?url=${encodeURIComponent(url)}`, { headers: { Origin: 'https://studio.test' }, ...options });
  try {
    assert.equal((await invoke('https://other.test/r.git/info/refs?service=git-upload-pack')).status, 403);
    assert.equal((await invoke('https://git.test/admin')).status, 403);
    assert.equal((await invoke('https://git.test/r.git/git-upload-pack', { method: 'DELETE' })).status, 403);
    assert.equal((await invoke('https://git.test/r.git/git-upload-pack', { headers: { Origin: 'https://evil.test' } })).status, 403);
    const allowed = await invoke('https://git.test/r.git/info/refs?service=git-upload-pack');
    assert.equal(allowed.status, 200);
    assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()), bytes);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://studio.test');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'error');
  } finally { await new Promise(resolve => proxy.close(resolve)); }
});

test('canonical REST fallback verifies hashes, obeys capabilities and moves refs after object creation', async () => {
  const oid = await hashObject('blob', bytes);
  const objects = new Map();
  const calls = [];
  const odb = { has: async key => objects.has(key), read: async key => objects.get(key), write: async (type, data) => {
    const key = await hashObject(type, data);
    objects.set(key, { oid: key, type, data });
    return key;
  } };
  const provider = {
    getCapabilities: async () => ({ canonicalObjects: true, atomicPush: true, objectFormat: 'sha1' }),
    getObject: async () => ({ type: 'blob', data: bytes }),
    writeObject: async object => { calls.push('object'); return object.oid; },
    updateRefs: async updates => { calls.push('refs'); return updates.map(update => ({ name: update.name, ok: true })); }
  };
  const transport = new RestGitTransport({ provider });
  await transport.fetch({ odb, wants: [oid] });
  assert.deepEqual(objects.get(oid).data, bytes);
  await transport.push({ odb, updates: [{ name: 'refs/heads/main', oldOid: null, newOid: oid }] });
  assert.deepEqual(calls, ['object', 'refs']);
  const snapshots = new RestGitTransport({ provider: { getCapabilities: async () => ({ canonicalObjects: false }) } });
  await assert.rejects(snapshots.fetch({ odb, wants: [oid] }), { code: 'Unsupported' });
});
