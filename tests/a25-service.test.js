import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageChannel } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { GitError, GitErrorCode, GitService, createGitService, createGitWorkerServer, GitWorkerClient } from '../packages/git/src/index.js';

const identity = { name: 'Git Acceptance', email: 'git@example.test', timestamp: 1700000000, timezone: '+0000' };

test('Git error codes have frozen serializable envelopes and unknown codes reject', () => {
  assert.ok(Object.isFrozen(GitErrorCode));
  for (const code of Object.values(GitErrorCode)) {
    const error = new GitError(code, 'Expected failure', { path: 'file.cs' });
    const envelope = error.toJSON();
    assert.ok(Object.isFrozen(envelope));
    assert.deepEqual(JSON.parse(JSON.stringify(error)), envelope);
    assert.equal(error.code, code);
  }
  assert.throws(() => new GitError('Invented', 'bad'), TypeError);
});

test('provider-free service creates isolated repositories and preserves the staged snapshot', async () => {
  const service = createGitService();
  try {
    await service.request('init', { repositoryId: 'first' });
    await service.request('init', { repositoryId: 'second' });
    await service.request('writeFile', { repositoryId: 'first', path: 'Program.cs', data: 'before\n' });
    await service.request('add', { repositoryId: 'first', path: 'Program.cs' });
    await service.request('writeFile', { repositoryId: 'first', path: 'Program.cs', data: 'after\n' });
    await service.request('commit', { repositoryId: 'first', message: 'First', author: identity, committer: identity });
    const history = await service.request('log', { repositoryId: 'first' });
    assert.equal(history.length, 1);
    const committed = await service.request('readFile', { repositoryId: 'first', path: 'Program.cs', revision: 'HEAD' });
    assert.equal(new TextDecoder().decode(committed.data), 'before\n');
    const working = await service.request('readFile', { repositoryId: 'first', path: 'Program.cs' });
    assert.equal(new TextDecoder().decode(working.data), 'after\n');
    assert.deepEqual(await service.request('log', { repositoryId: 'second' }), []);
    assert.deepEqual(await service.request('status', { repositoryId: 'second' }), []);
    await assert.rejects(service.request('init', { repositoryId: 'first' }), { code: 'Conflict' });
    await assert.rejects(service.request('status', { repositoryId: '../unsafe' }), { code: 'Unsafe' });
  } finally { await service.dispose(); }
  await assert.rejects(service.request('status'), { code: 'Disposed' });
});

test('worker routing isolates sessions and acknowledges cancellation within 100 ms', async () => {
  const { port1, port2 } = new MessageChannel();
  const server = createGitWorkerServer({ endpoint: port1, createService: () => createGitService({ operations: [{
    name: 'longOperation', global: true,
    run: (_, params, { signal, onProgress }) => new Promise((resolve, reject) => {
      onProgress?.({ phase: 'waiting' });
      const timer = setTimeout(resolve, 10000);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new GitError('Cancelled', 'cancelled')); }, { once: true });
    })
  }] }) });
  const first = new GitWorkerClient(port2, { session: 'first' });
  const second = new GitWorkerClient(port2, { session: 'second' });
  try {
    await Promise.all([first.request('init'), second.request('init')]);
    await first.request('writeFile', { path: 'one.txt', data: 'first' });
    assert.equal((await first.request('status')).length, 1);
    assert.equal((await second.request('status')).length, 0);
    const controller = new AbortController();
    let start;
    const operation = first.request('longOperation', {}, { signal: controller.signal, onProgress: () => {
      start = performance.now();
      controller.abort();
    } });
    await assert.rejects(operation, { code: 'Cancelled' });
    assert.ok(performance.now() - start < 100);
    await first.dispose();
    assert.equal((await second.request('status')).length, 0);
  } finally {
    await Promise.allSettled([first.dispose(), second.dispose()]);
    await server.dispose();
    port1.close();
    port2.close();
  }
});

test('mutation queue rejects cancelled queued work and lets unrelated repositories progress', async () => {
  const calls = [];
  let unlock;
  const barrier = new Promise(resolve => { unlock = resolve; });
  const service = new GitService({ repositoryFactory: async () => ({ status: async () => [], refs: { read: async () => null } }), operations: [{
    name: 'hold', mutates: true,
    async run(_, params) { calls.push(params.value); if (params.value === 'blocked') await barrier; return params.value; }
  }] });
  try {
    await service.request('init', { repositoryId: 'first' });
    await service.request('init', { repositoryId: 'second' });
    const held = service.request('hold', { repositoryId: 'first', value: 'blocked' });
    const cancellation = new AbortController();
    const queued = service.request('hold', { repositoryId: 'first', value: 'never' }, { signal: cancellation.signal });
    cancellation.abort();
    await assert.rejects(queued, { code: 'Cancelled' });
    assert.equal(await service.request('hold', { repositoryId: 'second', value: 'independent' }), 'independent');
    unlock();
    await held;
    assert.deepEqual(calls, ['blocked', 'independent']);
  } finally { unlock(); await service.dispose(); }
});
