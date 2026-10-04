import test from 'node:test';
import assert from 'node:assert/strict';
import {LazyDocumentStore, Workspace} from '@sharpforge/workspace';

const encode = value => new TextEncoder().encode(value);

test('A24 Workspace materializes SourceText and syntax only for opened or selected compilation inputs', async () => {
  let reads = 0;
  const provider = {check: path => path, async readFile(path) { reads++; return encode('class ' + path.slice(0, -3) + ' {}'); }};
  const store = new LazyDocumentStore(provider, {maxLoadedBytes: 1024});
  store.registerAll(Array.from({length: 5000}, (_, index) => ({path: `F${index}.cs`, size: 15, compile: index === 0})));
  const workspace = new Workspace({documentStore: store, maxWorkspaceBytes: 1024});
  assert.equal(workspace.documents.size, 0);
  assert.equal(reads, 0);
  await workspace.openFile('F1.cs', {pin: false});
  assert.equal(workspace.documents.size, 1);
  assert.equal(workspace.documents.get('F1.cs').parsed, null);
  workspace.syntax('F1.cs');
  assert.equal(workspace.metrics.parsedDocuments, 1);
  assert.equal(workspace.closeFile('F1.cs'), true);
  assert.equal(workspace.documents.size, 0);
  const firstVersion = workspace.versions.get('F1.cs');
  await workspace.compileAsync();
  assert.deepEqual([...workspace.documents.keys()], ['F0.cs']);
  assert.equal(reads, 2);
  assert(workspace.documents.get('F0.cs').parsed);
  await workspace.openFile('F1.cs');
  assert(workspace.documents.get('F1.cs').source.version > firstVersion);
  workspace.dispose();
  store.dispose();
});
