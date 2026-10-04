import test from 'node:test';
import assert from 'node:assert/strict';
import {readEditorSource, rebaseEditorSource} from '@sharpforge/editor';
import {importWorkspaceRecords, prefixWorkspace, ProjectSystem, readDirectory} from '@sharpforge/project-system';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {SlicedFile, sourceFileHandle, sourceDirectory} from './fixtures/a20-source-file-fixture.js';

async function prepared(path, text = 'class C {}') {
  const record = await readEditorSource(new SlicedFile([text], path), {uri: path});
  record.uri = path;
  Object.defineProperty(record, 'text', {enumerable: true, configurable: true,
    get() { throw new Error('Rebasing must not read the original text getter'); }});
  return record;
}

test('A20 prefixWorkspace rebases persistent source identity and leaves the input model caller-owned', async () => {
  const record = await prepared('src/Program.cs');
  const output = prefixWorkspace([record], ['src'], 'Imported', {rebaseSource: rebaseEditorSource});
  const rebased = output.records[0];
  assert.deepEqual(output.folders, ['Imported/src']);
  assert.equal(rebased.path, 'Imported/src/Program.cs');
  assert.equal(rebased.uri, rebased.path);
  assert.equal(rebased.source.uri, rebased.path);
  assert.equal(rebased.model.uri, rebased.path);
  assert.equal(rebased.source, rebased.model.snapshot());
  assert.notEqual(rebased.model, record.model);
  assert.equal(Object.getOwnPropertyDescriptor(rebased, 'model').enumerable, false);
  assert.equal(Object.getOwnPropertyDescriptor(rebased, 'source').enumerable, false);
  assert.equal(record.source.statistics.textMaterialized, false);
  assert.equal(rebased.source.statistics.textMaterialized, false);
  rebased.model.applyEdits([{start: 0, end: 5, text: 'struct'}]);
  assert.equal(record.model.getText(), 'class C {}');
  assert.equal(rebased.model.getText(), 'struct C {}');
  record.model.dispose();
  rebased.model.dispose();
});

test('A20 manifest extraction rebases source identities after validating all destination paths', async () => {
  const source = await prepared('download/Program.cs');
  const records = [source, {path: 'download/App.csproj', text: '<Project Sdk="Microsoft.NET.Sdk"/>'}, {
    path: 'download/.sharpforge/workspace.json',
    text: JSON.stringify({format: 'sharpforge-workspace', version: 1, entry: 'App.csproj', startup: 'App.csproj', active: 'Program.cs'})
  }];
  const extracted = importWorkspaceRecords(records, ['download', 'download/.sharpforge'], {rebaseSource: rebaseEditorSource});
  assert.equal(extracted.manifest, true);
  assert.equal(extracted.settings.entry, 'App.csproj');
  const rebased = extracted.records.find(record => record.path === 'Program.cs');
  assert.equal(rebased.model.uri, 'Program.cs');
  assert.equal(rebased.uri, 'Program.cs');
  assert.equal(source.model.uri, 'download/Program.cs');
  const system = new ProjectSystem(extracted.records);
  system.load('App.csproj');
  assert.deepEqual(system.compilationFiles('App.csproj').map(record => record.uri), ['Program.cs']);
  assert.equal(rebased.source.statistics.textMaterialized, false);
  source.model.dispose();
  rebased.model.dispose();
});

test('A20 unchanged source paths preserve descriptors and model ownership without a rebase provider', async () => {
  const source = await prepared('Program.cs');
  const result = prefixWorkspace([source], [], '').records[0];
  assert.equal(result.model, source.model);
  assert.equal(result.source, source.source);
  assert.equal(Object.getOwnPropertyDescriptor(result, 'text').get, Object.getOwnPropertyDescriptor(source, 'text').get);
  assert.throws(() => prefixWorkspace([source], [], 'New'), {code: 'SFPROJECT_SOURCE_REBASE'});
  source.model.applyEdits([{start: 0, end: 0, text: '// live\n'}]);
  assert.throws(() => rebaseEditorSource(source, 'New.cs'), /current prepared source snapshot/);
  source.model.dispose();
});

test('A20 failed rebasing disposes only newly created models and preserves every original', async () => {
  const first = await prepared('A.cs', 'class A {}');
  const second = await prepared('B.cs', 'class B {}');
  let created;
  assert.throws(() => prefixWorkspace([first, second], [], 'Imported', {
    rebaseSource(record, path) {
      if (record === second) throw new Error('second rebase failed');
      const rebased = rebaseEditorSource(record, path);
      created = rebased.model;
      return rebased;
    }
  }), /second rebase failed/);
  assert.throws(() => created.applyEdits([{start: 0, end: 0, text: 'bad'}]), /disposed/);
  for (const original of [first, second]) {
    original.model.applyEdits([{start: 0, end: 0, text: '// still owned\n'}]);
    original.model.dispose();
  }
});

test('A20 invalid manifest settings reject before any prepared source is rebased', async () => {
  const source = await prepared('repo/A.cs');
  const manifest = {path: 'repo/.sharpforge/workspace.json', text: JSON.stringify({
    format: 'sharpforge-workspace', version: 1, entry: 'Missing.csproj'
  })};
  let calls = 0;
  assert.throws(() => importWorkspaceRecords([source, manifest], [], {
    rebaseSource() { calls++; throw new Error('must not rebase'); }
  }), /Workspace entry is missing/);
  assert.equal(calls, 0);
  source.model.applyEdits([{start: 0, end: 0, text: '// still owned\n'}]);
  source.model.dispose();
});

test('A20 nested manifest rebasing keeps granted disk handles, source baselines and save versions aligned', async () => {
  const source = sourceFileHandle('A.cs', 'class A {}');
  const settings = JSON.stringify({format: 'sharpforge-workspace', version: 1, entry: 'App.csproj'});
  const project = {kind: 'file', async getFile() { return new File(['<Project Sdk="Microsoft.NET.Sdk"/>'], 'App.csproj'); }};
  const manifest = {kind: 'directory', async getFileHandle() {
    return {async getFile() { return new File([settings], 'workspace.json'); }};
  }};
  const directory = sourceDirectory({repo: sourceDirectory({'A.cs': source, 'App.csproj': project, '.sharpforge': manifest})});
  const original = await readDirectory(directory, {readSource: readStudioSource});
  const extracted = importWorkspaceRecords(original.records, original.folders, {rebaseSource: rebaseEditorSource});
  const disk = original.rebasePaths(extracted.pathMap, extracted.records, extracted.folders);
  const model = extracted.records.find(record => record.path === 'A.cs').model;
  assert.equal(disk.handles.get('A.cs'), source);
  assert.equal(disk.handles.has('repo/A.cs'), false);
  assert.equal(disk.baseline.get('A.cs'), original.baseline.get('repo/A.cs'));
  const version = disk.getVersion('A.cs');
  model.applyEdits([{start: 6, end: 7, text: 'Renamed'}]);
  await disk.save([{path: 'A.cs', source: model.snapshot(), expectedVersion: version}]);
  assert.equal(new TextDecoder().decode(source.bytes), 'class Renamed {}');
  assert.equal(disk.getVersion('A.cs'), version + 1);
  assert.equal(original.getVersion('repo/A.cs'), version);
  model.dispose();
  for (const record of original.records) record.model?.dispose();
});

test('A20 rebased disk sessions serialize with pending original saves and reject their stale baseline', async () => {
  let releasePermission;
  let enteredPermission;
  const permissionEntered = new Promise(resolve => { enteredPermission = resolve; });
  const permissionGate = new Promise(resolve => { releasePermission = resolve; });
  let requests = 0;
  const handle = sourceFileHandle('A.cs', 'original', {async permission() {
    if (++requests === 1) {
      enteredPermission();
      await permissionGate;
    }
    return 'granted';
  }});
  const original = await readDirectory(sourceDirectory({'A.cs': handle}), {readSource: readStudioSource});
  const prefixed = prefixWorkspace(original.records, [], 'Copy', {rebaseSource: rebaseEditorSource});
  const rebased = original.rebasePaths(new Map([['A.cs', 'Copy/A.cs']]), prefixed.records);
  const first = original.records[0].model;
  const next = prefixed.records[0].model;
  first.applyEdits([{start: 0, end: first.length, text: 'first saved'}]);
  next.applyEdits([{start: 0, end: next.length, text: 'stale saved'}]);
  const saving = original.save([{path: 'A.cs', source: first.snapshot()}]);
  await permissionEntered;
  const stale = rebased.save([{path: 'Copy/A.cs', source: next.snapshot()}]);
  releasePermission();
  await saving;
  await assert.rejects(stale, /Disk conflict/);
  assert.equal(new TextDecoder().decode(handle.bytes), 'first saved');
  assert.equal(handle.metrics.written, 1);
  first.dispose();
  next.dispose();
});
