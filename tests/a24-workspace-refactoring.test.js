import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '@sharpforge/workspace';
import {RefactoringEngine} from '@sharpforge/refactoring';
import {applyWorkspaceRefactoring} from '../apps/studio/workspace-refactoring.js';
import {workspaceFileNode, admitWorkspaceSource, navigateWorkspaceDiagnostic} from '../apps/studio/workspace-documents.js';

function compilation(records) {
  const workspace = new Workspace({compilationOptions: {outputKind: 'library'}});
  for (const record of records) workspace.update(record.path ?? record.uri, record.text, record.version ?? 1);
  return workspace;
}

function fixture() {
  const first = {uri: 'A.cs', text: 'class A { static int Get() { return 1; } }', version: 1};
  const second = {path: 'Closed/B.cs', text: 'class B { static int Get() { return 1; } }', version: 1};
  const state = {files: [first], extraFiles: [second], readOnly: false, revision: 1, tabs: ['A.cs'], active: 'A.cs',
    dirtyFiles: new Set(), disk: {}};
  let requests = 0;
  const records = () => {
    const sources = new Map(state.extraFiles.map(record => [record.path, record]));
    for (const file of state.files) sources.set(file.uri, {...file, path: file.uri});
    return [...sources.values()];
  };
  const host = {state, context: () => ({identity: 'fixture', revision: state.revision, disk: state.disk, records: records()}),
    request: async (_method, {action}) => {
      requests++;
      return new RefactoringEngine(compilation(records())).apply(action);
    },
    applyEdits: edits => {
      const result = new RefactoringEngine(compilation(state.files)).apply({edits}, {validate: false});
      for (const change of result.changes) {
        Object.assign(state.files.find(file => file.uri === change.uri), {text: change.text, version: change.version});
        state.dirtyFiles.add(change.uri);
      }
      state.revision++;
    }};
  const action = new RefactoringEngine(compilation(records())).replaceAll('1', '2');
  return {state, host, action, second, requests: () => requests};
}

test('validated multi-file replacement includes unopened sources without opening tabs or writing physical files', async () => {
  const app = fixture();
  const result = await applyWorkspaceRefactoring(app.host, app.action);
  assert.equal(result.changes.length, 2);
  assert.equal(app.requests(), 1);
  assert.ok(app.state.files.every(file => file.text.includes('return 2;')));
  assert.deepEqual([...app.state.dirtyFiles], ['Closed/B.cs', 'A.cs']);
  assert.deepEqual(app.state.tabs, ['A.cs']);
  assert.equal(app.state.active, 'A.cs');
  assert.equal(app.second.text.includes('return 1;'), true, 'original source record remains the disk baseline');
});

test('validation may hydrate a closed lazy input without treating it as an empty or missing document', async () => {
  const app = fixture();
  const text = app.second.text;
  delete app.second.text;
  app.second.lazy = true;
  app.second.size = text.length;
  const request = app.host.request;
  app.host.request = async (...args) => {
    Object.assign(app.second, {text, lazy: false});
    return request(...args);
  };
  await applyWorkspaceRefactoring(app.host, app.action);
  assert.equal(app.state.files.find(file => file.uri === 'Closed/B.cs').text.includes('return 2;'), true);
  assert.deepEqual(app.state.tabs, ['A.cs']);
});

for (const cause of ['stale', 'validation-error', 'revision', 'snapshot', 'generated', 'read-only']) {
  test('refactoring ' + cause + ' preserves every buffer and does not admit closed editors', async () => {
    const app = fixture();
    const before = app.state.files[0].text;
    if (cause === 'stale') app.action.edits[0].version = 99;
    if (cause === 'generated') app.second.generated = true;
    if (cause === 'read-only') app.second.readOnly = true;
    if (['validation-error', 'revision', 'snapshot'].includes(cause)) {
      const request = app.host.request;
      app.host.request = async (...args) => {
        if (cause === 'validation-error') throw new Error('Candidate compilation failed');
        const result = await request(...args);
        if (cause === 'revision') app.state.revision++;
        else result.changes[0].previous = 'different source';
        return result;
      };
    }
    await assert.rejects(applyWorkspaceRefactoring(app.host, app.action), /stale|failed|changed|mismatch|read-only/i);
    assert.deepEqual(app.state.files.map(file => file.uri), ['A.cs']);
    assert.equal(app.state.files[0].text, before);
    assert.equal(app.state.dirtyFiles.size, 0);
  });
}

test('source admission rejects oversized or excessive combined buffers before changing application membership', () => {
  const state = {files: [{uri: 'A.cs', text: 'class A {}', version: 7}]};
  const before = state.files;
  assert.throws(() => admitWorkspaceSource(state, {path: 'TooLarge.cs', text: ' '.repeat(2_000_001)}), /2 MB/);
  assert.equal(state.files, before);
  const many = {files: Array.from({length: 33}, (_, index) => ({uri: 'C' + index + '.cs', text: ' '.repeat(1_000_000)}))};
  const manyBefore = many.files;
  assert.throws(() => admitWorkspaceSource(many, {path: 'More.cs', text: ' '.repeat(1_000_000)}), /64 MiB/);
  assert.equal(many.files, manyBefore);
});

test('path navigation uses complete workspace metadata without requiring a materialized Explorer page', async () => {
  const context = {records: [{path: 'Closed/B.cs', lazy: true, size: 12}, {path: 'App.csproj', text: '<Project/>'},
    {path: 'library.dll', bytes: Uint8Array.of(0)}]};
  assert.deepEqual(workspaceFileNode(context, 'Closed/B.cs'), {kind: 'source', path: 'Closed/B.cs', label: 'B.cs'});
  assert.equal(workspaceFileNode(context, 'App.csproj').kind, 'project-file');
  assert.equal(workspaceFileNode(context, 'library.dll').kind, 'assembly');
  assert.throws(() => workspaceFileNode(context, 'Missing.cs'), /No such file/);
  const opened = [];
  const state = {files: [], extraFiles: [], projectSystem: {files: new Map(context.records.map(record => [record.path, record]))}};
  const host = {state, openFile: (...args) => opened.push(args), setPanel: panel => opened.push(panel)};
  await navigateWorkspaceDiagnostic(host, {uri: 'Closed/B.cs', start: 4, length: 3});
  await navigateWorkspaceDiagnostic(host, {uri: 'Missing.cs'});
  assert.deepEqual(opened, [['Closed/B.cs', 4, 7], 'project']);
});

test('test failures navigate from one-based lines and columns or LSP ranges to the failing source span', async () => {
  const opened = [];
  const state = {files: [], extraFiles: [{path: 'Test.cs', text: 'class Test {\n    // assertion\n}\n'}]};
  const host = {state, openFile: (...args) => opened.push(args), setPanel() {}, nativeBuild: {open: (...args) => opened.push(args)}};
  navigateWorkspaceDiagnostic(host, {path: 'Test.cs', line: 2, column: 5});
  navigateWorkspaceDiagnostic(host, {path: 'Test.cs', range: {start: {line: 1, character: 4}, end: {line: 1, character: 6}}});
  state.nativeMode = true;
  navigateWorkspaceDiagnostic(host, {path: 'Test.cs', line: 2, column: 5});
  assert.deepEqual(opened, [['Test.cs', 17, 18], ['Test.cs', 17, 19], ['Test.cs', 2, 5]]);
});
