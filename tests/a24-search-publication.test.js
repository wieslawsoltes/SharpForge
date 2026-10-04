import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceSearchIndex} from '@sharpforge/workspace';
import {DelayedProvider} from './support/a24-delayed-provider.js';

const bytes = text => new TextEncoder().encode(text);

async function fixture() {
  const provider = new DelayedProvider();
  await provider.writeFile('A.cs', bytes('original'));
  await provider.writeFile('Other.cs', bytes('other'));
  const diagnostics = [];
  const index = new WorkspaceSearchIndex(provider, {maxContentBytes: 16, onDiagnostic: value => diagnostics.push(value)});
  await index.addFiles([{path: 'A.cs', size: 8, version: 1}, {path: 'Other.cs', size: 5, version: 1}]);
  return {provider, index, diagnostics};
}

const invalidate = {
  'direct invalidation': async (index, provider) => {
    await provider.writeFile('A.cs', bytes('updated'));
    index.invalidate('A.cs');
  },
  'watcher update': async (index, provider) => {
    await provider.writeFile('A.cs', bytes('updated'));
    await index.onWatchEvent({type: 'changed', path: 'A.cs'});
  },
  'delete and recreate': async (index, provider) => {
    await index.onWatchEvent({type: 'deleted', path: 'A.cs'});
    await provider.writeFile('A.cs', bytes('updated'));
    index.upsert({path: 'A.cs', size: 7, version: 2});
  }
};

for (const [name, mutate] of Object.entries(invalidate)) {
  test('A24 search ' + name + ' cannot be followed by a stale cache publication', async () => {
    const {provider, index} = await fixture();
    const gate = provider.pause('read');
    const pending = index.text('A.cs');
    const rejected = assert.rejects(pending, error => error.code === 'Conflict');
    await gate.entered;
    await mutate(index, provider);
    gate.release();
    await rejected;
    assert.equal(index.contents.size, 0);
    assert.equal(index.contentBytes, 0);
    assert.equal(await index.text('A.cs'), 'updated');
    assert.equal(index.contents.get('A.cs').text, 'updated');
  });
}

test('A24 Find in Files reports a stale read and the next search observes the watcher update', async () => {
  const {provider, index, diagnostics} = await fixture();
  const gate = provider.pause('read');
  const pending = index.findInFiles('original', {paths: ['A.cs']});
  await gate.entered;
  await invalidate['watcher update'](index, provider);
  gate.release();
  assert.equal((await pending).matches.length, 0);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].path, 'A.cs');
  const current = await index.findInFiles('updated', {paths: ['A.cs']});
  assert.equal(current.matches.length, 1);
  assert.equal(current.matches[0].preview, 'updated');
});

test('A24 simultaneous search reads reuse a current cache entry and count its bytes once', async () => {
  const {provider, index} = await fixture();
  const gate = provider.pause('read');
  const pending = index.text('A.cs');
  await gate.entered;
  assert.equal(await index.text('A.cs'), 'original');
  gate.release();
  assert.equal(await pending, 'original');
  assert.equal(provider.reads, 2);
  assert.equal(index.contents.size, 1);
  assert.equal(index.contentBytes, 16);
  assert.equal(await index.text('Other.cs'), 'other');
  assert.equal(index.contents.size, 1);
  assert.equal(index.contentBytes, 10);
});

test('A24 another indexed entry can change without invalidating a pending search read', async () => {
  const {provider, index} = await fixture();
  const gate = provider.pause('read');
  const pending = index.text('A.cs');
  await gate.entered;
  index.upsert({path: 'Other.cs', size: 5, version: 2});
  gate.release();
  assert.equal(await pending, 'original');
});

for (const action of ['abort', 'dispose']) {
  test('A24 search ' + action + ' prevents delayed cache publication', async () => {
    const {provider, index} = await fixture();
    const gate = provider.pause('read');
    const controller = new AbortController();
    const pending = index.text('A.cs', controller.signal);
    const rejected = assert.rejects(pending, error => action === 'abort' ? error.name === 'AbortError' : error.code === 'Disposed');
    await gate.entered;
    if (action === 'abort') controller.abort();
    else index.dispose();
    gate.release();
    await rejected;
    assert.equal(index.contents.size, 0);
    assert.equal(index.contentBytes, 0);
  });
}
