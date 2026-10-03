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

test('A24 reload keeps dirty text until an explicit choice, rejects stale reload and reevaluates projects', async () => {
  const provider = new MemoryFileSystemProvider();
  await provider.writeFile('a.cs', bytes('disk one'));
  await provider.writeFile('App.csproj', bytes('<Project/>'));
  const documents = new Map([['a.cs', {text: 'old', version: 1, dirty: false}],
    ['App.csproj', {text: '<Project/>', version: 1, dirty: false}]]);
  const prompts = [];
  const reevaluations = [];
  const coordinator = new DocumentReloadCoordinator({provider, getDocument: path => documents.get(path),
    replaceDocument(path, record, {expectedVersion}) {
      assert.equal(documents.get(path)?.version, expectedVersion);
      documents.set(path, {text: record.text, version: expectedVersion + 1, dirty: false});
    }, removeDocument: path => documents.delete(path), onPrompt: prompt => prompts.push(prompt),
    onReevaluate: event => reevaluations.push(event.path)});
  await coordinator.handle({type: 'changed', path: 'a.cs'});
  assert.equal(documents.get('a.cs').text, 'disk one');
  documents.set('a.cs', {text: 'user edit', version: 3, dirty: true});
  await provider.writeFile('a.cs', bytes('disk two'));
  await coordinator.handle({type: 'changed', path: 'a.cs'});
  assert.equal(documents.get('a.cs').text, 'user edit');
  assert.equal(prompts.length, 1);
  assert.equal((await coordinator.choose('a.cs', 'compare')).diskText, 'disk two');
  await provider.writeFile('a.cs', bytes('disk three'));
  await assert.rejects(coordinator.choose('a.cs', 'reload'), error => error.code === 'Conflict');
  assert.equal(documents.get('a.cs').text, 'user edit');
  await coordinator.choose('a.cs', 'reload');
  assert.equal(documents.get('a.cs').text, 'disk three');
  await coordinator.handle({type: 'changed', path: 'App.csproj'});
  assert.deepEqual(reevaluations, ['App.csproj']);
  coordinator.dispose();
  await assert.rejects(coordinator.choose('a.cs', 'reload'), error => error.name === 'AbortError');
});
