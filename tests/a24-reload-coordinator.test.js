import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryFileSystemProvider, DocumentReloadCoordinator} from '@sharpforge/workspace';

const bytes = value => new TextEncoder().encode(value);

test('reload forwards atomic host evaluation acknowledgment for automatic and chosen XML updates', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('App.csproj', bytes('<Project/>'));
  let document = {text: '<Project/>', version: 1, dirty: false};
  const applications = [];
  const coordinator = new DocumentReloadCoordinator({provider, getDocument: () => document, replaceDocument() {},
    applyChange: ({disk, expectedVersion}) => {
      assert.equal(expectedVersion, document.version);
      document = {...disk, version: document.version + 1, dirty: false};
      return {reevaluated: true, revision: document.version};
    }, onReevaluate: ({application}) => applications.push(application)});
  await coordinator.handle({type: 'changed', path: 'App.csproj'});
  assert.deepEqual(applications, [{reevaluated: true, revision: 2}]);
  document = {...document, dirty: true};
  await coordinator.handle({type: 'changed', path: 'App.csproj'});
  await coordinator.choose('App.csproj', 'reload');
  assert.deepEqual(applications[1], {reevaluated: true, revision: 3});
  coordinator.dispose();
});

test('reload bounds prompts and preserves dirty buffers for keep and compare', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('A.cs', bytes('external'));
  await provider.writeFile('B.cs', bytes('external'));
  const documents = new Map([['A.cs', {text: 'mine', version: 1, dirty: true}], ['B.cs', {text: 'other', version: 2, dirty: true}]]);
  const coordinator = new DocumentReloadCoordinator({provider, maxPending: 1, getDocument: path => documents.get(path),
    replaceDocument() { assert.fail('A dirty buffer was replaced without a reload decision'); }});
  await coordinator.handle({type: 'changed', path: 'A.cs'});
  await assert.rejects(coordinator.handle({type: 'changed', path: 'B.cs'}), error => error.code === 'QuotaExceeded');
  assert.equal((await coordinator.choose('A.cs', 'compare')).localText, 'mine');
  await coordinator.choose('A.cs', 'keep');
  assert.equal(documents.get('A.cs').text, 'mine');
  assert.equal(coordinator.pending.size, 0);
  await assert.rejects(coordinator.choose('missing.cs', 'reload'), error => error.code === 'NotFound');
  coordinator.dispose();
});
