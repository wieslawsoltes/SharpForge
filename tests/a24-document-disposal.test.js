import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyDocumentStore} from '@sharpforge/workspace';

test('disposed metadata admission rejects without repopulating the document store', () => {
  const store = new LazyDocumentStore({check: path => path});
  store.dispose();
  assert.throws(() => store.registerAll([{path: 'A.cs', size: 1}]), error => error.code === 'Disposed');
  assert.equal(store.size, 0);
});
