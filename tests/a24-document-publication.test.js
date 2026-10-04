import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyDocumentStore} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = text => new TextEncoder().encode(text);

async function fixture() {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', bytes('original'));
  await provider.writeFile('Other.cs', bytes('other'));
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 256});
  store.registerAll([{path: 'A.cs', size: 8}, {path: 'Other.cs', size: 5}]);
  return {provider, store};
}

test('A24 a delayed lazy load cannot replace a dirty buffer admitted by another load', async () => {
  const {provider, store} = await fixture();
  const gate = provider.pause('read');
  const pending = store.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'Conflict');
  await gate.entered;
  await store.load('A.cs');
  const edited = store.update('A.cs', 'unsaved edits');
  const cost = store.loadedBytes;
  gate.release();
  await rejected;
  assert.equal(store.loaded.get('A.cs').record, edited);
  assert.equal(store.loaded.get('A.cs').dirty, true);
  assert.equal(store.loadedBytes, cost);
  assert.equal(store.unload('A.cs'), false);
});

test('A24 remove and register of the same path cannot revive an older lazy read', async () => {
  const {provider, store} = await fixture();
  const original = store.metadata('A.cs');
  const gate = provider.pause('read');
  const pending = store.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'Conflict');
  await gate.entered;
  store.remove('A.cs');
  store.register({path: 'A.cs', size: 3});
  assert.equal(store.metadata('A.cs').generation, original.generation);
  await provider.writeFile('A.cs', bytes('new'));
  gate.release();
  await rejected;
  assert.equal(store.loaded.size, 0);
  assert.equal(store.loadedBytes, 0);
  assert.equal((await store.load('A.cs')).text, 'new');
});

test('A24 closing a concurrently admitted document cannot be undone by an older load', async () => {
  const {provider, store} = await fixture();
  const gate = provider.pause('read');
  const pending = store.load('A.cs');
  const rejected = assert.rejects(pending, error => error.code === 'Conflict');
  await gate.entered;
  await store.load('A.cs');
  assert.equal(store.unload('A.cs'), true);
  gate.release();
  await rejected;
  assert.equal(store.loaded.size, 0);
  assert.equal(store.loadedBytes, 0);
});

test('A24 an unrelated lazy entry can load and change without invalidating this document', async () => {
  const {provider, store} = await fixture();
  const gate = provider.pause('read');
  const pending = store.load('A.cs');
  await gate.entered;
  await store.load('Other.cs');
  store.update('Other.cs', 'other edit');
  gate.release();
  assert.equal((await pending).text, 'original');
  assert.equal(store.loaded.get('Other.cs').record.text, 'other edit');
  assert.equal(store.loaded.get('Other.cs').dirty, true);
});

for (const action of ['abort', 'dispose']) {
  test('A24 lazy ' + action + ' prevents delayed contents from being admitted', async () => {
    const {provider, store} = await fixture();
    const gate = provider.pause('read');
    const controller = new AbortController();
    const pending = store.load('A.cs', {signal: controller.signal});
    const rejected = assert.rejects(pending, error => action === 'abort' ? error.name === 'AbortError' : error.code === 'Disposed');
    await gate.entered;
    if (action === 'abort') controller.abort();
    else store.dispose();
    gate.release();
    await rejected;
    assert.equal(store.loaded.size, 0);
    assert.equal(store.loadedBytes, 0);
  });
}

