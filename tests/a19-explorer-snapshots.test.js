import test from 'node:test';
import assert from 'node:assert/strict';
import { readEditorSource } from '@sharpforge/editor';
import { explorerDocuments } from './fixtures/a19-explorer-document-fixture.js';
import { SlicedFile } from './fixtures/a20-source-file-fixture.js';
import { readStudioSource } from '../apps/studio/workbench/studio-source-reader.js';

async function prepared(path, text = 'x'.repeat(130_000) + '\r\n') {
  const record = await readEditorSource(new SlicedFile([text], path), { uri: path, chunkSize: 65_537 });
  Object.defineProperty(record, 'text', { configurable: true, enumerable: true,
    get() { throw new Error('Explorer must not read prepared input text'); } });
  return record;
}

test('Explorer rename and undo preserve dirty snapshot baselines and leave unrelated models unchanged', async () => {
  const first = await prepared('A.cs');
  const second = await prepared('B.cs', 'class B {}');
  const fixture = explorerDocuments([first, second]);
  fixture.documents.open('A.cs');
  first.model.applyEdits([{ start: 0, end: 0, text: 'unsaved' }]);
  const source = first.model.snapshot();
  const baseline = fixture.documents.baselines.get('A.cs');
  await fixture.commands.perform([{ kind: 'move', path: 'A.cs', destination: 'src/Main.cs' }], [{ from: 'A.cs', to: 'src/Main.cs' }]);
  const moved = fixture.documents.get('src/Main.cs');
  assert.equal(moved.model.uri, 'src/Main.cs');
  assert.equal(moved.model.getText(0, 7), 'unsaved');
  assert.equal(moved.dirty, true);
  assert.equal(fixture.documents.baselines.get(moved.uri).uri, moved.uri);
  assert.equal(fixture.documents.baselines.get(moved.uri).getText(0, 1), 'x');
  assert.equal(fixture.documents.models.get('B.cs'), second.model);
  assert.equal(fixture.documents.active, moved.uri);
  assert.throws(() => first.model.prepareEdits([]), /disposed/);
  const history = fixture.commands.history[0];
  assert.equal(history.before.records[0].model, undefined);
  assert.equal(history.before.records[0].source, source);
  assert.equal(history.after[0].model, undefined);
  await fixture.commands.undo();
  const restored = fixture.documents.get('A.cs');
  assert.equal(restored.source, source);
  assert.equal(restored.dirty, true);
  assert.equal(fixture.documents.baselines.get('A.cs'), baseline);
  assert.equal(fixture.documents.active, 'A.cs');
  assert.equal(fixture.documents.models.get('B.cs'), second.model);
  assert.equal(fixture.commands.history.length, 0);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(baseline.statistics.textMaterialized, false);
  fixture.dispose();
});

test('Explorer copies are independent unsaved models and sequential file undo retains earlier snapshot identity', async () => {
  const original = await prepared('A.cs');
  const fixture = explorerDocuments([original]);
  await fixture.commands.perform([{ kind: 'copy', path: 'A.cs', destination: 'B.cs' }]);
  const copy = fixture.documents.get('B.cs').model;
  assert.notEqual(copy, original.model);
  assert.equal(fixture.documents.get('B.cs').dirty, true);
  assert.equal(fixture.documents.baselines.get('B.cs'), null);
  assert.equal(fixture.documents.get('A.cs').dirty, false);
  await fixture.commands.perform([{ kind: 'delete', path: 'B.cs' }]);
  assert.throws(() => copy.prepareEdits([]), /disposed/);
  await fixture.commands.undo();
  assert.equal(fixture.documents.get('B.cs').dirty, true);
  assert.equal(fixture.documents.baselines.get('B.cs'), null);
  await fixture.commands.undo();
  assert.equal(fixture.documents.get('B.cs'), null);
  assert.equal(fixture.documents.models.get('A.cs'), original.model);
  assert.equal(original.source.statistics.textMaterialized, false);
  fixture.dispose();
});

test('Explorer source writes prepare a replacement without mutating current text and undo restores a lazy root', async () => {
  const original = await prepared('A.cs');
  const fixture = explorerDocuments([original]);
  await fixture.commands.perform([{ kind: 'write', path: 'A.cs', text: 'class Replacement {}' }]);
  assert.equal(fixture.documents.get('A.cs').model.getText(0, 5), 'class');
  assert.equal(fixture.documents.get('A.cs').dirty, true);
  assert.equal(fixture.documents.baselines.get('A.cs'), original.source);
  assert.throws(() => original.model.prepareEdits([]), /disposed/);
  await fixture.commands.undo();
  assert.equal(fixture.documents.get('A.cs').source, original.source);
  assert.equal(fixture.documents.get('A.cs').dirty, false);
  assert.equal(original.source.statistics.textMaterialized, false);
  fixture.dispose();
});

test('Explorer snapshot history refuses newer edits without reading either complete source', async () => {
  const original = await prepared('A.cs');
  const fixture = explorerDocuments([original]);
  await fixture.commands.perform([{ kind: 'copy', path: 'A.cs', destination: 'B.cs' }]);
  original.model.applyEdits([{ start: 0, end: 0, text: 'newer' }]);
  await assert.rejects(fixture.commands.undo(), /newer edits/);
  assert.equal(fixture.commands.history.length, 1);
  assert.equal(fixture.documents.models.size, 2);
  assert.equal(original.source.statistics.textMaterialized, false);
  assert.equal(original.model.snapshot().statistics.textMaterialized, false);
  fixture.dispose();
});

test('Explorer failed preflight and host commit keep existing owners intact and dispose staged replacement models', async () => {
  const original = await prepared('A.cs');
  const fixture = explorerDocuments([original]);
  await assert.rejects(fixture.commands.perform([
    { kind: 'copy', path: 'A.cs', destination: 'B.cs' }, { kind: 'create', path: 'A.cs', text: 'collision' }
  ]), /exists/);
  assert.equal(fixture.documents.models.size, 1);
  let staged;
  fixture.host.commit = async payload => { staged = payload.records.find(record => record.path === 'B.cs').model; throw new Error('Host rejected'); };
  await assert.rejects(fixture.commands.perform([{ kind: 'copy', path: 'A.cs', destination: 'B.cs' }]), /Host rejected/);
  assert.throws(() => staged.prepareEdits([]), /disposed/);
  assert.doesNotThrow(() => original.model.prepareEdits([]));
  assert.equal(fixture.commands.history.length, 0);
  fixture.dispose();
});

test('Explorer Add Existing Item accepts sources beyond 16 MiB using chunked File reads and records undo without flattening', async () => {
  const fixture = explorerDocuments([]);
  const file = new SlicedFile(['x'.repeat(17 * 1024 * 1024)], 'Large.cs');
  fixture.host.pickFiles = async () => [file];
  const result = await fixture.commands.run('add-existing', { kind: 'folder', path: 'src' });
  assert.equal(result?.error, undefined);
  const record = fixture.documents.get('src/Large.cs');
  assert.equal(record.length, file.size);
  assert.equal(record.dirty, true);
  assert.equal(record.source.statistics.textMaterialized, false);
  assert(file.reads.length > 64);
  assert(file.reads.every(read => read.end - read.start <= 256 * 1024));
  assert.equal(fixture.commands.history.length, 1);
  assert.equal(fixture.commands.history[0].after[0].source, record.source);
  const model = record.model;
  await fixture.commands.undo();
  assert.equal(fixture.documents.files.length, 0);
  assert.throws(() => model.prepareEdits([]), /disposed/);
  fixture.dispose();
});

test('Explorer Add Existing Item updates project membership while retaining the prepared source descriptor', async () => {
  const fixture = explorerDocuments([{ path: 'App/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"/>' }]);
  fixture.host.pickFiles = async () => [new SlicedFile(['class Added {}'], 'Added.cs')];
  const result = await fixture.commands.run('add-existing', { kind: 'project', path: 'App/App.csproj', project: 'App/App.csproj' });
  assert.equal(result?.error, undefined);
  const record = fixture.documents.get('App/Added.cs');
  assert.equal(record.source.statistics.textMaterialized, false);
  assert.equal(record.model.uri, record.uri);
  assert.match(fixture.context().records.find(value => value.path.endsWith('.csproj')).text, /Compile Include="Added.cs"/);
  await fixture.commands.undo();
  assert.equal(fixture.documents.files.length, 0);
  assert.equal(fixture.context().records[0].text, '<Project Sdk="Microsoft.NET.Sdk"/>');
  fixture.dispose();
});

test('Explorer rejected or cancelled multi-file import cleans up only its prepared models', async () => {
  for (const failure of ['reader', 'workspace', 'commit']) {
    const original = await prepared('Original.cs', 'original');
    const fixture = explorerDocuments([original]);
    const created = [];
    fixture.host.pickFiles = async () => [new SlicedFile(['first'], 'First.cs'), new SlicedFile(['second'], 'Second.cs')];
    fixture.host.readSource = async (file, options) => {
      if (file.name === 'Second.cs' && failure === 'reader') throw new Error('Read unavailable');
      const record = await readStudioSource(file, options);
      created.push(record.model);
      if (file.name === 'Second.cs' && failure === 'workspace') fixture.setContext({ identity: 'different workspace' });
      return record;
    };
    fixture.host.rejectCommit = failure === 'commit';
    const result = await fixture.commands.run('add-existing', { kind: 'workspace' });
    assert.equal(typeof result.error, 'string');
    assert.equal(fixture.documents.models.size, 1);
    assert.doesNotThrow(() => original.model.prepareEdits([]));
    for (const model of created) assert.throws(() => model.prepareEdits([]), /disposed/);
    fixture.dispose();
  }
});

test('Explorer disposed imports cancel between chunks and postcommit callback errors retain adopted ownership and history', async () => {
  const cancelled = explorerDocuments([]);
  cancelled.host.pickFiles = async () => [new SlicedFile(['x'.repeat(300_000)], 'Cancelled.cs')];
  cancelled.host.onFileProgress = () => cancelled.commands.dispose();
  const failure = await cancelled.commands.run('add-existing', { kind: 'workspace' });
  assert.match(failure.error, /cancelled/);
  assert.equal(cancelled.documents.files.length, 0);
  cancelled.documents.dispose();

  const fixture = explorerDocuments([]);
  fixture.host.pickFiles = async () => [new SlicedFile(['class Added {}'], 'Added.cs')];
  const unsubscribe = fixture.documents.subscribe(event => { if (event.type === 'reset') throw new Error('View refresh failed'); });
  const result = await fixture.commands.run('add-existing', { kind: 'workspace' });
  assert.equal(typeof result.error, 'string');
  const model = fixture.documents.models.get('Added.cs');
  assert.equal(fixture.documents.ownsModel(model), true);
  assert.doesNotThrow(() => model.prepareEdits([]));
  assert.equal(fixture.commands.history.length, 1);
  unsubscribe();
  await fixture.commands.undo();
  assert.equal(fixture.documents.files.length, 0);
  fixture.dispose();
});

test('Explorer native source payload limits remain explicit before native I/O', async () => {
  const fixture = explorerDocuments([]);
  fixture.setContext({ native: true });
  let nativeCalls = 0;
  fixture.host.saveNative = async () => { nativeCalls++; };
  fixture.host.pickFiles = async () => [new SlicedFile(['x'.repeat(16 * 1024 * 1024 + 1)], 'Large.cs')];
  const result = await fixture.commands.run('add-existing', { kind: 'workspace' });
  assert.match(result.error, /Native existing items.*16 MiB/);
  assert.equal(nativeCalls, 0);
  fixture.dispose();
});
