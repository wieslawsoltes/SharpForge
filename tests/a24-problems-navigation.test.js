import test from 'node:test';
import assert from 'node:assert/strict';
import {escapeHtml} from '@sharpforge/editor';
import {createStudioRenderers} from '../apps/studio/tools/core.js';

function fixture(loadWorkspaceRecord, options = {}) {
  const row = {dataset: {diagnostic: '0'}};
  const element = {innerHTML: '', scrollTop: 0};
  const state = {files: [], extraFiles: [{path: 'Test.cs', lazy: true, size: 31}], workspaceEpoch: 1, revision: 2,
    result: {diagnostics: [{uri: 'Test.cs', severity: 'error', code: 'CS0001', message: 'Test diagnostic',
      range: {start: {line: 1, character: 4}, end: {line: 1, character: 6}}}]}};
  const opened = [], failures = [];
  const context = {state, E: escapeHtml, $$: selector => selector === '[data-diagnostic]' ? [row] : [],
    hydrate() {}, debugTools: {renderTool: () => false}, loadWorkspaceRecord,
    openFile: options.openFile ?? ((...args) => opened.push(args)), toast: (...args) => failures.push(args)};
  createStudioRenderers(context).renderPanel('problems', element);
  return {state, row, opened, failures};
}

test('Problems dispatch loads an unopened source before selecting the diagnostic line and column', async () => {
  const reads = [];
  const app = fixture(async path => {
    reads.push(path);
    return {path, text: 'class Test {\n    // assertion\n}\n'};
  });
  await app.row.onclick();
  assert.deepEqual(reads, ['Test.cs']);
  assert.deepEqual(app.opened, [['Test.cs', 17, 19]]);
  assert.deepEqual(app.failures, []);
});

test('Problems dispatch reports a lazy navigation race without selecting a stale source range', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const app = fixture(() => pending);
  const clicked = app.row.onclick();
  app.state.revision++;
  release({path: 'Test.cs', text: 'class Test {\n    // assertion\n}\n'});
  await clicked;
  assert.deepEqual(app.opened, []);
  assert.equal(app.failures.length, 1);
  assert.match(app.failures[0][0], /Workspace changed while resolving/);
  assert.equal(app.failures[0][1], 'error');
});

test('Problems dispatch reports synchronous editor failures through the same visible error boundary', async () => {
  const app = fixture(() => assert.fail('loaded diagnostics must not read disk'),
    {openFile() { throw new Error('Editor unavailable'); }});
  app.state.files.push({uri: 'Test.cs', text: 'class Test {\n    // assertion\n}\n'});
  await app.row.onclick();
  assert.deepEqual(app.opened, []);
  assert.deepEqual(app.failures, [['Editor unavailable', 'error']]);
});
