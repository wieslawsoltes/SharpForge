import test from 'node:test';
import assert from 'node:assert/strict';
import {exportWorkspaceZip} from '@sharpforge/project-system';
import {openStudioWorkspaceZip, importStudioFiles} from '../apps/studio/workbench/studio-file-import.js';
import {WorkspaceLoads} from '../apps/studio/workbench/workspace-loads.js';

function fixture() {
  const state = {workspaceEpoch: 1, nativeMode: false, disk: null, projectSystem: null, readOnly: false};
  const documents = {revision: 1, disposed: false};
  const loads = new WorkspaceLoads();
  const commits = [];
  const context = {
    state,
    async withLoad(action, options = {}) {
      const load = options.load ?? loads.begin({state, documents, signal: options.signal});
      try { return await action(load); }
      finally { if (!options.load) load.finish(); }
    },
    loadRecords(records, options) {
      options.load.check();
      commits.push({records, options});
      return true;
    }
  };
  return {state, documents, loads, commits, context};
}

function slicedArchive(onRead = () => {}) {
  const text = '// ' + 'source payload '.repeat(6000);
  const bytes = exportWorkspaceZip({records: [{path: 'Program.cs', text}],
    folders: ['Assets'], settings: {name: 'Streamed workspace', mode: 'folder'}});
  const blob = new Blob([bytes]);
  const slices = [];
  const file = {
    name: 'workspace.zip', size: blob.size,
    arrayBuffer() { assert.fail('Studio ZIP ingress must not request a whole-file buffer'); },
    slice(start, end) {
      slices.push([start, end]);
      return {async arrayBuffer() {
        const result = await blob.slice(start, end).arrayBuffer();
        onRead(slices.length);
        return result;
      }};
    }
  };
  return {file, text, slices};
}

test('Studio ZIP selection streams bounded slices and retains settings on the original load ticket', async t => {
  const f = fixture();
  t.after(() => f.loads.dispose());
  const archive = slicedArchive();
  assert.equal(await importStudioFiles([archive.file], {}, f.context), true);
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].records[0].text, archive.text);
  assert.equal(f.commits[0].options.name, 'Streamed workspace');
  assert(f.commits[0].options.folders.includes('Assets'));
  assert(archive.slices.length > 3);
  assert(Math.max(...archive.slices.map(([start, end]) => end - start)) <= 65557);
});

test('ZIP cancellation and source changes during preparation cannot adopt a workspace', async t => {
  for (const mode of ['abort', 'edit']) {
    const f = fixture();
    t.after(() => f.loads.dispose());
    const controller = new AbortController();
    const archive = slicedArchive(count => {
      if (count !== 1) return;
      if (mode === 'abort') controller.abort(new DOMException('Cancelled import', 'AbortError'));
      else f.documents.revision++;
    });
    await assert.rejects(openStudioWorkspaceZip(archive.file, {signal: controller.signal}, f.context), {name: 'AbortError'});
    assert.equal(f.commits.length, 0);
    assert.equal(f.state.workspaceEpoch, 1);
  }
});

test('Studio rejects oversized ZIP input before any read or document adoption', async t => {
  const f = fixture();
  t.after(() => f.loads.dispose());
  const file = {name: 'oversized.zip', size: 160 * 1024 * 1024 + 1,
    slice() { assert.fail('Input budget must be checked before reading'); }};
  await assert.rejects(openStudioWorkspaceZip(file, {}, f.context), /160 MiB/);
  assert.equal(f.commits.length, 0);
});
