import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitAuthContext } from '../packages/git/src/auth/context.js';
import { createAuthOperations } from '../packages/git/src/auth/service.js';

const remote = 'https://github.com/acme/project';
const parent = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const blob = 'c'.repeat(40);

async function service(content = 'AAH+/w==') {
  const context = createGitAuthContext();
  const calls = [];
  await context.invoke('grant', { remoteId: 'origin', origins: ['https://github.com', 'https://api.github.com'], consent: true });
  const routes = new Map([
    ['/repos/acme/project/git/matching-refs/', [{ ref: 'refs/heads/main', object: { sha: parent } }]],
    [`/repos/acme/project/git/commits/${parent}`, { sha: parent, tree: { sha: tree }, parents: [], message: 'Initial' }],
    [`/repos/acme/project/git/trees/${tree}`, { tree: [{ path: 'binary.dat', type: 'blob', mode: '100644', sha: blob }] }],
    [`/repos/acme/project/git/blobs/${blob}`, { encoding: 'base64', content }]
  ]);
  const operations = createAuthOperations(context, { fetch: async (url, request) => {
    const path = new URL(url).pathname;
    calls.push({ path, request });
    if (!routes.has(path)) throw new Error('Unexpected provider request');
    return Response.json(routes.get(path));
  } });
  return { context, calls, invoke: (name, params, signal) => operations.find(value => value.name === name)
    .run(null, { remote, provider: 'github', remoteId: 'origin', ...params }, { signal }) };
}

test('A25 snapshot RPC preserves binary bytes and publishes its actual consistency capabilities', async () => {
  const { context, calls, invoke } = await service();
  const capabilities = await invoke('git.snapshot', { operation: 'capabilities' });
  assert.equal(capabilities.canonicalObjects, false);
  assert.equal(capabilities.compareAndSwap, true);
  assert.equal(calls.length, 0);
  const result = await invoke('git.snapshot', { operation: 'read', input: { ref: 'main' } });
  assert.equal(result.oid, parent);
  assert.equal(result.files[0].content instanceof Uint8Array, true);
  assert.deepEqual(result.files[0].content, new Uint8Array([0, 1, 254, 255]));
  assert.equal(calls.every(value => value.request.method === 'GET'), true);
  await context.dispose();
});

test('A25 snapshot RPC rejects unbounded input, cancellation, unconfirmed mutation, and credential-bearing content', async () => {
  const { context, calls, invoke } = await service('cGxhbnRlZC1zZWNyZXQ=');
  await assert.rejects(invoke('git.snapshot', { operation: 'read', input: { maximumFiles: Infinity } }), { code: 'Limit' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(invoke('git.snapshot', { operation: 'refs' }, controller.signal), { code: 'Cancelled' });
  assert.equal(calls.length, 0);
  await assert.rejects(invoke('git.snapshot', { operation: 'commit',
    input: { ref: 'main', expectedOid: parent, message: 'Denied', files: [] } }), { code: 'Auth' });
  assert.equal(calls.some(value => value.request.method !== 'GET'), false);
  context.redactor.register('planted-secret');
  await assert.rejects(invoke('git.snapshot', { operation: 'read' }), { code: 'Unsafe' });
  await assert.rejects(invoke('git.provider', { operation: 'request', input: { method: 'POST' } }), { code: 'Unsupported' });
  await context.dispose();
});
