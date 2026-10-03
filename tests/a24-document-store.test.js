import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyDocumentStore} from '@sharpforge/workspace';

const encode = value => new TextEncoder().encode(value);

test('A24 5000 closed files hold metadata only and loaded documents obey the byte budget', async () => {
  let reads = 0;
  const provider = {check: path => path, async readFile(path) { reads++; return encode('content ' + path); }};
  const evicted = [];
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 100, onEvict: path => evicted.push(path)});
  store.registerAll(Array.from({length: 5000}, (_, index) => ({path: `F${index}.cs`, size: 10})));
  assert.equal(store.size, 5000);
  assert.equal(store.loaded.size, 0);
  assert.equal(reads, 0);
  assert.throws(() => store.register({path: 'unbudgeted.cs', text: 'x'.repeat(1000)}), /metadata only/);
  assert.throws(() => store.registerAll([{path: 'unbudgeted.bin', bytes: new Uint8Array(1000)}]), /metadata only/);
  await store.load('F1.cs', {pin: true});
  await store.load('F2.cs');
  await store.load('F3.cs');
  assert(store.loaded.has('F1.cs'));
  assert(store.loadedBytes <= 100);
  assert(evicted.includes('F2.cs'));
  store.update('F1.cs', 'dirty');
  assert.equal(store.unload('F1.cs'), false);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.load('F4.cs', {signal: controller.signal}), error => error.name === 'AbortError');
  const before = store.size;
  assert.throws(() => store.registerAll([{path: 'New.cs'}, {path: 'F1.cs'}]));
  assert.equal(store.size, before);
  store.dispose();
  await assert.rejects(store.load('F1.cs'), error => error.code === 'Disposed');
});

test('A24 file admission failure retains the previous dirty buffer and invalidation rejects stale async data', async () => {
  let resolve;
  const provider = {check: path => path, readFile: () => new Promise(complete => { resolve = complete; })};
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 30});
  store.register({path: 'a.cs', size: 1});
  const pending = store.load('a.cs');
  store.register({path: 'a.cs', size: 2});
  resolve(encode('text'));
  await assert.rejects(pending, error => error.code === 'Conflict');
  store.admit('a.cs', {path: 'a.cs', text: 'dirty', bytes: encode('dirty')}, {dirty: true});
  assert.throws(() => store.admit('a.cs', {text: 'x'.repeat(100)}), error => error.code === 'QuotaExceeded');
  assert.equal(store.loaded.get('a.cs').record.text, 'dirty');
});
