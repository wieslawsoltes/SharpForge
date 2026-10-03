import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearchIndex} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = text => new TextEncoder().encode(text);

for (const action of ['delete', 'replace', 'dispose']) {
  test('delayed search metadata cannot survive ' + action + ' of its current entry', async () => {
    const provider = new DelayedProvider();
    await provider.writeFile('A.cs', bytes('old'));
    const index = new WorkspaceSearchIndex(provider);
    const gate = provider.pause('stat');
    const pending = index.onWatchEvent({type: 'created', path: 'A.cs'});
    const rejected = assert.rejects(pending, error => error.code === (action === 'dispose' ? 'Disposed' : 'Conflict'));
    await gate.entered;
    if (action === 'delete') await index.onWatchEvent({type: 'deleted', path: 'A.cs'});
    else if (action === 'replace') index.upsert({path: 'A.cs', size: 12, version: 9});
    else index.dispose();
    gate.release();
    await rejected;
    assert.equal(index.entries.get('A.cs')?.version, action === 'replace' ? 9 : undefined);
    assert.equal(index.pendingStats.size, 0);
    index.dispose();
  });
}

test('search metadata probes are bounded while statuses are unresolved', async () => {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', bytes('a'));
  await provider.writeFile('Other.cs', bytes('b'));
  const index = new WorkspaceSearchIndex(provider, {maxEntries: 1});
  const gate = provider.pause('stat');
  const pending = index.onWatchEvent({type: 'created', path: 'A.cs'});
  await gate.entered;
  await assert.rejects(index.onWatchEvent({type: 'created', path: 'Other.cs'}), error => error.code === 'QuotaExceeded');
  assert.equal(index.pendingStats.size, 1);
  gate.release();
  await pending;
  assert.equal(index.entries.size, 1);
  index.dispose();
  assert.equal(index.indexBytes, 0);
  assert.equal(index.contentBytes, 0);
});

for (const action of ['replace', 'dispose', 'abort']) {
  test('search watch setup releases its subscription after ' + action, async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const subscriptions = [];
    const provider = {check: path => path, async watch() {
      const subscription = {disposed: false, dispose() { this.disposed = true; }};
      subscriptions.push(subscription);
      if (subscriptions.length === 1) await gate;
      return subscription;
    }};
    const index = new WorkspaceSearchIndex(provider);
    const controller = new AbortController();
    const pending = index.watch({signal: controller.signal});
    const rejected = assert.rejects(pending, error => action === 'abort' ? error.name === 'AbortError'
      : error.code === (action === 'dispose' ? 'Disposed' : 'Conflict'));
    if (action === 'replace') await index.watch();
    else if (action === 'dispose') index.dispose();
    else controller.abort();
    release();
    await rejected;
    assert.equal(subscriptions[0].disposed, true);
    if (action === 'replace') assert.equal(index.subscription, subscriptions[1]);
    index.dispose();
    assert(subscriptions.every(subscription => subscription.disposed));
  });
}
