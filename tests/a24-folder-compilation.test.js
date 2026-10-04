import test from 'node:test';
import assert from 'node:assert/strict';
import {readProviderDirectory as readDirectory} from '@sharpforge/project-system';
import {Workspace} from '@sharpforge/workspace';
import {readPE} from '@sharpforge/cil';
import {prepareWorkspaceRecords} from '../apps/studio/workspace-records.js';
import {prepareProjectRequest, projectCompilationFiles} from '../apps/studio/project-build.js';
import {createCompilationHandler} from '../apps/studio/workers/compilation-handler.js';
import {TestDirectoryHandle} from './support/a24-fsa.js';

test('a real 300-file folder builds and analyzes all closed C# sources while keeping one editor buffer', async () => {
  const root = new TestDirectoryHandle();
  await root.put('Program.cs', 'System.Console.WriteLine(Closed299.Value());');
  for (let index = 1; index < 300; index++) {
    await root.put('Closed' + index + '.cs', `class Closed${index} { public static int Value() { return ${index}; } }`);
  }
  await root.put('opaque.bin', Uint8Array.of(0, 255));
  const disk = await readDirectory(root);
  assert(disk.records.filter(record => record.path.endsWith('.cs')).every(record => record.lazy));
  const prepared = await prepareWorkspaceRecords(disk.records, {disk, mode: 'folder', active: 'Program.cs'});
  const state = {disk, files: prepared.files, extraFiles: prepared.records.filter(record => record.path !== 'Program.cs'),
    projectSystem: null, revision: 1, workspaceEpoch: 1, name: 'Folder', langVersion: '14'};
  assert.equal(state.files.length, 1);
  state.files[0] = {...state.files[0], text: 'System.Console.WriteLine(Closed299.Value() + 1);', version: 2};
  const build = await prepareProjectRequest(state, 'build');
  assert.equal(build.files.length, 300);
  assert.equal(build.files.find(file => file.uri === 'Program.cs').text, state.files[0].text);
  assert.equal(build.buildPlan, undefined);
  const workspace = new Workspace({compilationOptions: build.compilationOptions, maxDocuments: 20000});
  for (const file of build.files) workspace.update(file.uri, file.text, file.version);
  const handler = createCompilationHandler(workspace);
  const result = handler(build, 'build');
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert(readPE(result.assembly).metadata.rows[32].length);
  const analyze = await prepareProjectRequest(state, 'analyze');
  assert.equal(analyze.files.length, 300);
  const analyzed = handler(analyze, 'analyze');
  assert.equal(analyzed.success, true, JSON.stringify(analyzed.diagnostics));
  assert.equal(state.files.length, 1, 'compilation does not create 299 editor buffers');
  assert.equal(projectCompilationFiles(state).length, 300);
  assert.equal(root.children.get('opaque.bin').reads, 0);
  assert.equal(root.children.get('Closed299.cs').reads, 1, 'later analysis reuses loaded original text');
});

test('folder membership remains authoritative after a virtual deletion even when disk still has the original file', async () => {
  const state = {files: [{uri: 'Program.cs', text: 'System.Console.WriteLine(1);'}], extraFiles: [], revision: 1,
    disk: {records: [{path: 'Deleted.cs', text: 'class Deleted {}'}]}, name: 'Folder'};
  const request = await prepareProjectRequest(state, 'analyze');
  assert.deepEqual(request.files.map(file => file.uri), ['Program.cs']);
});

test('folder hydration refuses missing, binary, oversized or excessive inputs without fabricating empty text', async () => {
  const state = (record, load) => ({files: [], extraFiles: [record], revision: 1, disk: load ? {load} : null});
  await assert.rejects(prepareProjectRequest(state({path: 'Closed.cs', lazy: true, size: 1}), 'build'), /unavailable/);
  await assert.rejects(prepareProjectRequest(state({path: 'Closed.cs', lazy: true, size: 2},
    async path => ({path, bytes: Uint8Array.of(0, 255)})), 'build'), /requires source text/);
  await assert.rejects(prepareProjectRequest(state({path: 'Huge.cs', text: ' '.repeat(2_000_001)}), 'build'), /2 MB/);
  await assert.rejects(prepareProjectRequest({files: [], revision: 1,
    extraFiles: Array.from({length: 20001}, (_, index) => ({path: `C${index}.cs`, lazy: true, size: 1}))}, 'build'), /count limit/);
  await assert.rejects(prepareProjectRequest({files: [], revision: 1,
    extraFiles: Array.from({length: 34}, (_, index) => ({path: `C${index}.cs`, text: ' '.repeat(1_000_000)}))}, 'build'), /64 MiB/);
});

test('cancelled and replaced folder hydrations retain the original unopened membership', async () => {
  for (const changed of ['abort', 'revision', 'disk', 'epoch']) {
    const controller = new AbortController();
    const record = {path: 'Closed.cs', lazy: true, size: 10};
    const state = {files: [], extraFiles: [record], revision: 1, workspaceEpoch: 1};
    state.disk = {load: async path => {
      if (changed === 'abort') controller.abort();
      if (changed === 'revision') state.revision++;
      if (changed === 'disk') state.disk = {};
      if (changed === 'epoch') state.workspaceEpoch++;
      return {path, text: 'class Closed {}'};
    }};
    await assert.rejects(prepareProjectRequest(state, 'analyze', {signal: controller.signal}), /abort|changed/i);
    assert.equal(state.extraFiles[0], record);
    assert.equal(state.files.length, 0);
  }
});
