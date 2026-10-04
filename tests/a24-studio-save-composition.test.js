import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel} from '@sharpforge/editor';
import {hashFileBytes} from '@sharpforge/workspace';
import {saveStudioSourceAs} from '../apps/studio/workbench/source-save-as.js';
import {sourceFileHandle} from './fixtures/a20-source-file-fixture.js';
import {studioDiskFixture} from './support/a24-studio-workspace-fixture.js';

const encode = text => new TextEncoder().encode(text);
const readText = async (fixture, path) => new TextDecoder().decode(await fixture.provider.readFile(path));

test('Studio provider save captures source, project XML and binary changes without flattening the model', async t => {
  const fixture = await studioDiskFixture(t, {files: [
    ['A.cs', 'class A {}'], ['A.csproj', '<Project />'], ['asset.bin', Uint8Array.of(0, 128, 255)]
  ]});
  const model = fixture.documents.models.get('A.cs');
  model.applyEdits([{start: 0, end: 0, text: '// saved\n'}]);
  const source = model.snapshot();
  fixture.state.extraFiles.find(record => record.path === 'A.csproj').text = '<Project><PropertyGroup /></Project>';
  fixture.state.extraFiles.find(record => record.path === 'asset.bin').bytes = Uint8Array.of(3, 0, 4);
  fixture.state.dirtyFiles.add('A.csproj');
  fixture.state.dirtyFiles.add('asset.bin');
  fixture.state.membershipDirty = true;
  const result = await fixture.saves.disk();
  assert.deepEqual(new Set(result.written), new Set(['A.cs', 'A.csproj', 'asset.bin']));
  assert.equal(await readText(fixture, 'A.cs'), '// saved\nclass A {}');
  assert.equal(await readText(fixture, 'A.csproj'), '<Project><PropertyGroup /></Project>');
  assert.deepEqual(await fixture.provider.readFile('asset.bin'), Uint8Array.of(3, 0, 4));
  assert.equal(fixture.documents.baselines.get('A.cs'), source);
  assert.equal(fixture.state.dirtyFiles.size, 0);
  assert.equal(source.statistics.textMaterialized, false);
  assert.equal(fixture.state.membershipDirty, true, 'saving bytes does not forget pending structural membership');
});

test('a later model edit remains dirty after the captured source finishes physical I/O', async t => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const fixture = await studioDiskFixture(t, {beforeClose: async () => {
    entered.resolve();
    await release.promise;
  }});
  const model = fixture.documents.models.get('A.cs');
  model.applyEdits([{start: 0, end: 0, text: '// captured\n'}]);
  const captured = model.snapshot();
  const saving = fixture.saves.disk();
  await entered.promise;
  model.applyEdits([{start: 0, end: 0, text: '// newer\n'}]);
  const newer = model.snapshot();
  release.resolve();
  assert.deepEqual((await saving).written, ['A.cs']);
  assert.equal(await readText(fixture, 'A.cs'), '// captured\nclass A {}');
  assert.equal(model.snapshot(), newer);
  assert.equal(fixture.documents.baselines.get('A.cs'), captured);
  assert.equal(fixture.documents.require('A.cs').dirty, true);
  assert.equal(captured.statistics.textMaterialized, false);
});

test('save admission retains its captured source while waiting for workspace persistence coordination', async t => {
  const fixture = await studioDiskFixture(t);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  fixture.host.persistenceReady = async () => { entered.resolve(); await release.promise; };
  const model = fixture.documents.models.get('A.cs');
  model.applyEdits([{start: 0, end: 0, text: '// captured\n'}]);
  const captured = model.snapshot();
  const saving = fixture.saves.disk();
  await entered.promise;
  model.applyEdits([{start: 0, end: 0, text: '// later\n'}]);
  release.resolve();
  await saving;
  assert.equal(await readText(fixture, 'A.cs'), '// captured\nclass A {}');
  assert.equal(fixture.documents.baselines.get('A.cs'), captured);
  assert.equal(fixture.documents.require('A.cs').dirty, true);
});

test('provider permission completion cannot write for a replacement document with the same URI and version', async t => {
  const fixture = await studioDiskFixture(t);
  fixture.documents.models.get('A.cs').applyEdits([{start: 0, end: 0, text: '// captured\n'}]);
  const captured = fixture.documents.captureSave('A.cs');
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve('granted'));
  fixture.root.queryPermission = async ({mode}) => {
    if (mode !== 'readwrite') return 'granted';
    entered.resolve();
    return release.promise;
  };
  const saving = assert.rejects(fixture.saves.disk(), {name: 'AbortError'});
  await entered.promise;
  const replacement = new EditorModel('// replacement', {uri: 'A.cs', version: captured.version});
  fixture.documents.replace([{uri: 'A.cs', model: replacement, source: replacement.snapshot(), version: replacement.version}],
    {discard: true, tabs: ['A.cs'], active: 'A.cs'});
  const baseline = replacement.snapshot();
  release.resolve('granted');
  await saving;
  assert.deepEqual(fixture.writes, []);
  assert.equal(await readText(fixture, 'A.cs'), 'class A {}');
  assert.equal(fixture.documents.models.get('A.cs'), replacement);
  assert.equal(fixture.documents.baselines.get('A.cs'), baseline);
});

test('provider permission completion is fenced by the exact workspace disk identity', async t => {
  const fixture = await studioDiskFixture(t);
  fixture.documents.models.get('A.cs').applyEdits([{start: 0, end: 0, text: '// pending\n'}]);
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve('granted'));
  fixture.root.queryPermission = async ({mode}) => {
    if (mode !== 'readwrite') return 'granted';
    entered.resolve();
    return release.promise;
  };
  const saving = assert.rejects(fixture.saves.disk(), {name: 'AbortError'});
  await entered.promise;
  fixture.state.disk = {};
  release.resolve('granted');
  await saving;
  assert.deepEqual(fixture.writes, []);
  assert.equal(await readText(fixture, 'A.cs'), 'class A {}');
  assert.equal(fixture.documents.require('A.cs').dirty, true);
});

test('provider workspace saves retain the successful per-document Save As target', async t => {
  const chosen = sourceFileHandle('Chosen.cs', '');
  const fixture = await studioDiskFixture(t, {files: [['A.cs', 'class A {}'], ['A.csproj', '<Project />']],
    saveOptions: {saveAs: (snapshot, options) => saveStudioSourceAs(snapshot, {
      ...options, window: {showSaveFilePicker: () => chosen}
    })}});
  const model = fixture.documents.models.get('A.cs');
  model.applyEdits([{start: 0, end: 0, text: '// first\n'}]);
  assert.equal((await fixture.saves.as('A.cs')).ok, true);
  model.applyEdits([{start: 0, end: 0, text: '// second\n'}]);
  fixture.state.extraFiles.find(record => record.path === 'A.csproj').text = '<Project Sdk="Microsoft.NET.Sdk" />';
  fixture.state.dirtyFiles.add('A.csproj');
  const saved = model.snapshot();
  assert.deepEqual(new Set((await fixture.saves.disk()).written), new Set(['A.cs', 'A.csproj']));
  assert.equal(new TextDecoder().decode(chosen.bytes), '// second\n// first\nclass A {}');
  assert.equal(await readText(fixture, 'A.cs'), 'class A {}');
  assert.equal(await readText(fixture, 'A.csproj'), '<Project Sdk="Microsoft.NET.Sdk" />');
  assert.equal(fixture.documents.baselines.get('A.cs'), saved);
  assert.equal(fixture.documents.require('A.cs').dirty, false);
});

test('a conflict adoption keeps physical baselines committed when a post-adoption observer fails', async t => {
  const fixture = await studioDiskFixture(t, {files: [['A.cs', 'first\nsecond\nthird\n']]});
  fixture.documents.models.get('A.cs').applyEdits([{start: 0, end: 5, text: 'mine'}]);
  await fixture.provider.writeFile('A.cs', encode('first\nsecond\ntheirs\n'));
  fixture.host.chooseSaveConflict = () => 'merge';
  const failure = new Error('Post-adoption view failed');
  fixture.context.renderWorkspace = () => { throw failure; };
  await assert.rejects(fixture.saves.disk(), error => error === failure && error.committed === true);
  const expected = 'mine\nsecond\ntheirs\n';
  assert.equal(await readText(fixture, 'A.cs'), expected);
  assert.equal(fixture.documents.models.get('A.cs').snapshot().getText(0, expected.length), expected);
  assert.equal(fixture.documents.require('A.cs').dirty, false);
  assert.equal(fixture.disk.baselineHashes.get('A.cs'), await hashFileBytes(encode(expected)));
});

test('accepted conflict replacement owns its saved baseline without cleaning the replaced document capture', async t => {
  for (const choice of ['merge', 'take-theirs']) {
    const fixture = await studioDiskFixture(t, {files: [['A.cs', 'first\nsecond\nthird\n']]});
    fixture.documents.models.get('A.cs').applyEdits([{start: 0, end: 5, text: 'mine'}]);
    const previous = fixture.documents.require('A.cs');
    const captured = fixture.documents.captureSave('A.cs');
    await fixture.provider.writeFile('A.cs', encode('first\nsecond\ntheirs\n'));
    fixture.host.chooseSaveConflict = () => choice;
    fixture.documents.coordinateSave = options => fixture.saves.coordinate(options);
    assert.equal(await fixture.documents.save('A.cs'), false, 'the original document save no longer owns its replaced record');
    const current = fixture.documents.require('A.cs');
    const expected = choice === 'merge' ? 'mine\nsecond\ntheirs\n' : 'first\nsecond\ntheirs\n';
    assert.notEqual(current, previous);
    assert.equal(current.dirty, false);
    assert.equal(await readText(fixture, 'A.cs'), expected);
    const baseline = fixture.documents.baselines.get('A.cs');
    assert.equal(baseline, fixture.documents.models.get('A.cs').snapshot());
    assert.notEqual(baseline, captured.source);
    assert.equal(baseline.getText(0, baseline.length), expected);
  }
});
