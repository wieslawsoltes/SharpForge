import test from 'node:test';
import assert from 'node:assert/strict';
import {readEditorSource} from '@sharpforge/editor';
import {FileSystemAccessProvider, WorkspaceSaveLocks} from '@sharpforge/workspace';
import {ProviderDiskWorkspace} from '@sharpforge/project-system';
import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
import {explorerDocuments} from './fixtures/a19-explorer-document-fixture.js';
import {SlicedFile} from './fixtures/a20-source-file-fixture.js';
import {memoryDirectory} from './support/memory-directory-handle.js';

async function prepared(path, bytes) {
  const record = await readEditorSource(new SlicedFile([bytes], path), {uri: path, chunkSize: 65_537});
  record.bytes = bytes.slice();
  Object.defineProperty(record, 'text', {configurable: true, enumerable: true,
    get() { throw new Error('Prepared Explorer records must not flatten their source'); }});
  return record;
}

test('prepared UTF-16 writes and later moves preserve exact provider bytes through undo and redo', async t => {
  const root = memoryDirectory();
  const provider = new FileSystemAccessProvider(root);
  const originalText = 'class Original {}\r\n';
  const replacementText = 'class Replacement { string Value = "日本語😀"; }\r\n';
  const firstBytes = encodeWorkspaceFile({path: 'A.cs', text: originalText, encoding: 'utf-16le', bom: true});
  const secondBytes = new TextEncoder().encode('class Other {}\n');
  await provider.writeFile('A.cs', firstBytes);
  await provider.writeFile('B.cs', secondBytes);
  let lockAdmissions = 0;
  const locks = new WorkspaceSaveLocks({identity: 'prepared-explorer', locks: {
    request: (_name, _options, action) => { lockAdmissions++; return action(); }
  }});
  t.after(() => locks.dispose());
  const disk = new ProviderDiskWorkspace([
    decodeWorkspaceFile('A.cs', firstBytes), decodeWorkspaceFile('B.cs', secondBytes)
  ], new Map(), 'Prepared sources', [], [], {rootHandle: root, provider, saveLocks: locks});
  await disk.initializeBaselines();
  const first = await prepared('A.cs', firstBytes);
  const second = await prepared('B.cs', secondBytes);
  const fixture = explorerDocuments([first, second]);
  t.after(() => fixture.dispose());
  fixture.setContext({disk});
  second.model.applyEdits([{start: 0, end: 0, text: '// unrelated unsaved edit\n'}]);
  const unrelated = second.model.snapshot();
  const initial = first.source;
  const expected = encodeWorkspaceFile({path: 'A.cs', text: replacementText, encoding: 'utf-16le', bom: true});

  await fixture.commands.perform([{kind: 'write', path: 'A.cs', text: replacementText}]);
  const replacement = fixture.documents.get('A.cs').source;
  assert.notEqual(replacement, initial);
  assert.deepEqual(await provider.readFile('A.cs'), expected);
  assert.equal(fixture.documents.get('A.cs').dirty, false);
  assert.equal(fixture.documents.baselines.get('A.cs'), replacement);
  assert.equal(fixture.commands.history[0].before.records[0].source, initial);
  assert.equal(fixture.commands.history[0].after[0].model, undefined);

  await fixture.commands.perform([{kind: 'move', path: 'A.cs', destination: 'Renamed.cs'}],
    [{from: 'A.cs', to: 'Renamed.cs'}]);
  assert.deepEqual(await provider.readFile('Renamed.cs'), expected);
  assert.equal(fixture.documents.get('Renamed.cs').model.uri, 'Renamed.cs');
  await fixture.commands.undo();
  assert.deepEqual(await provider.readFile('A.cs'), expected);
  await fixture.commands.undo();
  assert.deepEqual(await provider.readFile('A.cs'), firstBytes);
  assert.equal(fixture.documents.get('A.cs').source, initial);
  await fixture.commands.redo();
  await fixture.commands.redo();
  assert.deepEqual(await provider.readFile('Renamed.cs'), expected);
  assert.equal(fixture.commands.history.length, 2);
  assert.equal(fixture.commands.fileHistory.redoStack.length, 0);
  assert.equal(fixture.documents.get('Renamed.cs').dirty, false);
  assert.equal(fixture.documents.models.get('B.cs'), second.model);
  assert.equal(fixture.documents.get('B.cs').dirty, true);
  assert.equal(second.model.snapshot(), unrelated);
  assert.deepEqual(await provider.readFile('B.cs'), secondBytes);
  assert(lockAdmissions >= 6);
  for (const source of [initial, replacement, unrelated, fixture.documents.get('Renamed.cs').source]) {
    assert.equal(source.statistics.textMaterialized, false);
  }
});

test('committed observer failures advance one prepared-source history stack during both undo and redo', async t => {
  const original = await prepared('A.cs', new TextEncoder().encode('class Original {}'));
  const fixture = explorerDocuments([original]);
  t.after(() => fixture.dispose());
  await fixture.commands.perform([{kind: 'copy', path: 'A.cs', destination: 'B.cs'}]);
  const copied = fixture.documents.models.get('B.cs');
  const unsubscribe = fixture.documents.subscribe(event => {
    if (event.type === 'reset') throw new Error('Observer rejected the completed view refresh');
  });
  t.after(unsubscribe);
  await assert.rejects(fixture.commands.undo(), {committed: true});
  assert.equal(fixture.documents.get('B.cs'), null);
  assert.equal(fixture.commands.history.length, 0);
  assert.equal(fixture.commands.fileHistory.canRedo, true);
  assert.throws(() => copied.prepareEdits([]), /disposed/);
  await assert.rejects(fixture.commands.redo(), {committed: true});
  const restored = fixture.documents.get('B.cs');
  assert.equal(fixture.documents.ownsModel(restored.model), true);
  assert.doesNotThrow(() => restored.model.prepareEdits([]));
  assert.equal(restored.dirty, true);
  assert.equal(fixture.documents.baselines.get('B.cs'), null);
  assert.equal(fixture.commands.history.length, 1);
  assert.equal(fixture.commands.fileHistory.canRedo, false);
  assert.equal(fixture.commands.history[0].before.records[0].model, undefined);
  assert.equal(fixture.commands.history[0].after[1].model, undefined);
  assert.equal(fixture.documents.models.get('A.cs'), original.model);
  assert.equal(original.source.statistics.textMaterialized, false);
  assert.equal(restored.source.statistics.textMaterialized, false);
});

test('explicit write text is admitted before a supplied prepared XML snapshot', async t => {
  const original = '<Project/>';
  const snapshot = await prepared('App.csproj', new TextEncoder().encode(original));
  t.after(() => snapshot.model.dispose());
  const fixture = explorerDocuments([{path: 'App.csproj', text: original}]);
  t.after(() => fixture.dispose());
  await assert.rejects(fixture.commands.perform([
    {kind: 'write', path: 'App.csproj', record: snapshot, text: '<Project>'}
  ]), /XML|closing|element|Unexpected/i);
  await assert.rejects(fixture.commands.perform([
    {kind: 'write', path: 'App.csproj', record: snapshot, text: 'x'.repeat(4 * 1024 * 1024 + 1)}
  ]), /size limit/);
  assert.equal(fixture.context().records[0].text, original);
  assert.equal(fixture.host.lastPrepared, undefined);
  assert.equal(fixture.commands.history.length, 0);
  assert.equal(snapshot.source.statistics.textMaterialized, false);
  assert.doesNotThrow(() => snapshot.model.prepareEdits([]));
});

test('operation supplied C# text rejects source reader losses before journal adoption', async t => {
  const original = await prepared('A.cs', new TextEncoder().encode('class A {}'));
  const fixture = explorerDocuments([original]);
  t.after(() => fixture.dispose());
  for (const text of ['class A {}\u0000', '\ufeffclass A {}']) {
    await assert.rejects(fixture.commands.perform([{kind: 'write', path: 'A.cs', text}]),
      {code: 'SFPROJECT_SOURCE_ENCODING_LOSS'});
    await assert.rejects(fixture.commands.perform([{kind: 'create', path: 'B.cs', text}]),
      {code: 'SFPROJECT_SOURCE_ENCODING_LOSS'});
  }
  assert.equal(fixture.documents.models.get('A.cs'), original.model);
  assert.equal(fixture.documents.get('A.cs').source, original.source);
  assert.equal(fixture.documents.get('B.cs'), null);
  assert.equal(fixture.commands.history.length, 0);
  assert.equal(original.source.statistics.textMaterialized, false);
});

test('dirty C# moves and copies reject unreopenable snapshots before physical effects', async t => {
  const root = memoryDirectory();
  const provider = new FileSystemAccessProvider(root);
  const bytes = new TextEncoder().encode('class A {}');
  await provider.writeFile('A.cs', bytes);
  const locks = new WorkspaceSaveLocks({identity: 'native-source-admission', locks: {
    request: (_name, _options, action) => action()
  }});
  t.after(() => locks.dispose());
  const disk = new ProviderDiskWorkspace([decodeWorkspaceFile('A.cs', bytes)], new Map(), 'Source admission', [], [],
    {rootHandle: root, provider, saveLocks: locks});
  await disk.initializeBaselines();
  const original = await prepared('A.cs', bytes);
  const fixture = explorerDocuments([original]);
  t.after(() => fixture.dispose());
  fixture.setContext({disk});
  original.model.applyEdits([{start: 0, end: 0, text: '\ufeff'}]);
  const dirty = original.model.snapshot();
  for (const kind of ['copy', 'move']) {
    await assert.rejects(fixture.commands.perform([{kind, path: 'A.cs', destination: 'B.cs'}]),
      {code: 'SFPROJECT_SOURCE_ENCODING_LOSS'});
    assert.deepEqual(await provider.readFile('A.cs'), bytes);
    await assert.rejects(provider.stat('B.cs'), {code: 'NotFound'});
  }
  assert.equal(fixture.documents.models.get('A.cs'), original.model);
  assert.equal(fixture.documents.get('A.cs').source, dirty);
  assert.equal(fixture.documents.get('A.cs').dirty, true);
  assert.equal(fixture.commands.history.length, 0);
  assert.equal(dirty.statistics.textMaterialized, false);
});
