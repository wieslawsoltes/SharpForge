import test from 'node:test';
import assert from 'node:assert/strict';
import {navigateWorkspaceDiagnostic} from '../apps/studio/workspace-documents.js';

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

function diagnosticFixture() {
  const record = {path: 'Test.cs', lazy: true};
  const state = {files: [], extraFiles: [record], disk: {}, workspaceEpoch: 1, revision: 2};
  const opened = [];
  const host = {state, openFile: (...args) => opened.push(args), setPanel: panel => opened.push(panel),
    loadRecord: async () => ({path: 'Test.cs', text: 'class Test {\n    // assertion\n}\n'})};
  return {host, state, opened};
}

test('line and range diagnostics load exact source contents before converting offsets', async () => {
  const {host, opened} = diagnosticFixture();
  await navigateWorkspaceDiagnostic(host, {path: 'Test.cs', line: 2, column: 5});
  await navigateWorkspaceDiagnostic(host, {uri: 'Test.cs', start: 17,
    range: {start: {line: 1, character: 4}, end: {line: 1, character: 6}}});
  assert.deepEqual(opened, [['Test.cs', 17, 18], ['Test.cs', 17, 19]]);
});

for (const mutation of ['workspaceEpoch', 'disk', 'projectSystem', 'revision', 'nativeMode']) {
  test('diagnostic navigation rejects a changed ' + mutation + ' after lazy source I/O', async () => {
    const {host, state, opened} = diagnosticFixture();
    const release = gate();
    host.loadRecord = async () => { await release.promise; return {text: 'class Test {}'}; };
    const pending = navigateWorkspaceDiagnostic(host, {path: 'Test.cs', line: 2, column: 5});
    const rejected = assert.rejects(pending, {name: 'FileSystemError', code: 'Conflict', path: 'Test.cs'});
    state[mutation] = mutation === 'nativeMode' ? true : {};
    release.resolve();
    await rejected;
    assert.deepEqual(opened, []);
  });
}

test('unavailable source contents reject line navigation instead of silently selecting offset zero', async () => {
  const {host, opened} = diagnosticFixture();
  delete host.loadRecord;
  await assert.rejects(navigateWorkspaceDiagnostic(host, {path: 'Test.cs', line: 2}), /Original source contents are unavailable/);
  assert.deepEqual(opened, []);
  await navigateWorkspaceDiagnostic(host, {path: 'Test.cs', start: 17, length: 3});
  assert.deepEqual(opened, [['Test.cs', 17, 20]]);
});

