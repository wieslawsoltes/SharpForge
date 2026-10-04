import test from 'node:test';
import assert from 'node:assert/strict';
import { GitService } from '../packages/git/src/service.js';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

const repository = dispose => ({ status: async () => [], refs: { read: async () => null }, dispose });

test('closing an opening repository waits for cleanup and holds its identity reservation', async () => {
  const started = deferred();
  const release = deferred();
  let disposed = 0;
  const service = new GitService({ repositoryFactory: async () => {
    started.resolve();
    await release.promise;
    return { repository: repository(), dispose: async () => { disposed++; } };
  } });
  try {
    const opening = service.request('init', { repositoryId: 'held' });
    await started.promise;
    let finished = false;
    const closing = service.request('close', { repositoryId: 'held' }).then(value => { finished = true; return value; });
    await assert.rejects(opening, { code: 'Cancelled' });
    await assert.rejects(service.request('init', { repositoryId: 'held' }), { code: 'Conflict' });
    assert.equal(finished, false);
    release.resolve();
    assert.equal(await closing, true);
    assert.equal(disposed, 1);
    assert.deepEqual(await service.request('repositories'), []);
    await service.request('init', { repositoryId: 'held' });
  } finally { release.resolve(); await service.dispose(); }
  assert.equal(disposed, 2);
});

test('service disposal waits for global operation cleanup before destroying owned resources', async () => {
  const started = deferred();
  const release = deferred();
  const events = [];
  const service = new GitService({ repositoryFactory: async () => repository(),
    resources: [{ dispose() { events.push('resource'); } }], operations: [{ name: 'hold', global: true,
      async run() { started.resolve(); await release.promise; events.push('operation'); }
    }] });
  const running = service.request('hold');
  await started.promise;
  const disposal = service.dispose();
  assert.equal(service.dispose(), disposal);
  await assert.rejects(running, { code: 'Cancelled' });
  await assert.rejects(service.request('init'), { code: 'Disposed' });
  assert.deepEqual(events, []);
  release.resolve();
  await disposal;
  assert.deepEqual(events, ['operation', 'resource']);
});

test('closing a cancelled repository open reports a late owned-resource cleanup failure', async () => {
  const started = deferred();
  const release = deferred();
  const service = new GitService({ repositoryFactory: async () => {
    started.resolve();
    await release.promise;
    return { repository: repository(), dispose() { throw new Error('Owned store cleanup failed'); } };
  } });
  try {
    const opening = service.request('init');
    await started.promise;
    const closing = service.request('close');
    await assert.rejects(opening, { code: 'Cancelled' });
    release.resolve();
    await assert.rejects(closing, /Owned store cleanup failed/u);
    assert.deepEqual(await service.request('repositories'), []);
  } finally { release.resolve(); await service.dispose(); }
});

test('cancellation while reading initial HEAD respects boolean repository ownership', async () => {
  const started = deferred();
  const release = deferred();
  let disposed = 0;
  const owned = repository(() => { disposed++; });
  owned.refs.read = async () => { started.resolve(); await release.promise; return null; };
  const service = new GitService({ repositoryFactory: async () => ({ repository: owned, dispose: true }) });
  const controller = new AbortController();
  try {
    const opening = service.request('open', {}, { signal: controller.signal });
    await started.promise;
    controller.abort();
    await assert.rejects(opening, { code: 'Cancelled' });
    const closing = service.request('close');
    release.resolve();
    await closing;
    assert.equal(disposed, 1);
  } finally { release.resolve(); await service.dispose(); }
});

test('queued operations observe the revision at execution and cancelled queue entries never execute', async () => {
  const release = deferred();
  const started = deferred();
  const observed = [];
  const service = new GitService({ repositoryFactory: async () => repository(), operations: [{
    name: 'record', mutates: true,
    async run(_, params, context) {
      observed.push([params.name, context.repositoryRevision]);
      if (params.name === 'first') { started.resolve(); await release.promise; }
    }
  }] });
  try {
    await service.request('init');
    const first = service.request('record', { name: 'first' });
    await started.promise;
    const controller = new AbortController();
    const cancelled = service.request('record', { name: 'cancelled' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { code: 'Cancelled' });
    const second = service.request('record', { name: 'second' });
    release.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(observed, [['first', 0], ['second', 1]]);
  } finally { release.resolve(); await service.dispose(); }
});

test('repository opening participates in the global pending-operation limit', async () => {
  const started = deferred();
  const release = deferred();
  const service = new GitService({ maxPending: 1, repositoryFactory: async () => {
    started.resolve(); await release.promise; return repository();
  } });
  try {
    const first = service.request('init', { repositoryId: 'first' });
    await started.promise;
    await assert.rejects(service.request('init', { repositoryId: 'second' }), { code: 'Limit' });
    release.resolve();
    await first;
  } finally { release.resolve(); await service.dispose(); }
});
