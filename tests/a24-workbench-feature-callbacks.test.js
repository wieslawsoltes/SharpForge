import test from 'node:test';
import assert from 'node:assert/strict';
import { designerConfiguration } from '../apps/studio/workbench/lazy-features/designer-configuration.js';
import { nativeConfiguration } from '../apps/studio/workbench/lazy-features/native-configuration.js';
import { NativeBuildFacade } from '../apps/studio/workbench/lazy-features/facades.js';

test('lazy designer activation retains XML source services alongside captured diagnostic and C# callbacks', async () => {
  const calls = [];
  const diagnostics = {};
  const context = { state: { files: [], revision: 1 }, designerDiagnostics: diagnostics,
    explorerContext: () => ({ records: [{ path: 'View.xaml', text: '<Grid/>' }] }),
    applyMarkupSourceEdits: async (...args) => { calls.push(['apply', ...args]); return 'applied'; },
    editMarkupSourceText: async (...args) => { calls.push(['edit', ...args]); return 'edited'; } };
  const configured = designerConfiguration(context);
  assert.equal(configured.diagnostics, diagnostics);
  assert.equal(configured.records()[0].path, 'View.xaml');
  assert.equal(await configured.applyMarkupSourceEdits('View.xaml', { text: '<Grid/>' }, 1, 'guard'), 'applied');
  assert.equal(await configured.editMarkupSourceText('View.xaml', '<Grid/>', 1), 'edited');
  assert.equal(typeof configured.applySourceEdits, 'function');
  assert.equal(typeof configured.editSourceText, 'function');
  assert.deepEqual(calls.map(call => call[0]), ['apply', 'edit']);
});

test('lazy native activation forwards hydrated context and test ports without replacing job ownership callbacks', async () => {
  const calls = [];
  const context = { state: {}, onProjectContext: payload => calls.push(['context', payload]),
    getTestInput: options => ({ files: [], signal: options.signal }), getTestProject: () => 'App.csproj',
    getTestSources: () => ['source'], onOpenTestSource: point => calls.push(['source', point]),
    download: () => 'download', onNativeJobFailure: (...args) => calls.push(['failure', ...args]) };
  const configured = nativeConfiguration(context);
  const signal = new AbortController().signal;
  assert.equal(configured.getTestInput({ signal }).signal, signal);
  assert.equal(configured.getTestProject(), 'App.csproj');
  assert.deepEqual(configured.getTestSources(), ['source']);
  configured.onProjectContext({ context: { id: 'net8' } });
  configured.onOpenTestSource({ path: 'Program.cs', line: 2 });
  const ownership = { selected: false, projectId: 'Background.csproj' };
  configured.onJobFailure('job:1', new Error('failed'), ownership);
  assert.equal(calls[2][3], ownership);
  assert.equal(configured.download(), 'download');
  assert.equal(typeof configured.onAttach, 'function');
  assert.equal(typeof configured.onSaved, 'function');
});

test('native generated sources retain metadata and remain read-only through the lazy open callback', async () => {
  const added = [];
  const state = { files: [], revision: 1 };
  const configured = nativeConfiguration({ state, documents: { add: record => { added.push(record); return record; } },
    renderWorkspace() {}, openFile() {}, status() {} });
  await configured.onOpenSource({ path: 'Generated.g.cs', text: 'class Generated {}', version: 7,
    generated: true, project: 'App.csproj', contextId: 'net8', hash: null }, 1, 1);
  assert.equal(added[0].readOnly, true);
  assert.equal(added[0].generated, true);
  assert.equal(added[0].version, 7);
  assert.equal(added[0].contextId, 'net8');
  assert.equal(added[0].nativeBaseline, 'class Generated {}');
});

test('native façade exposes model state passively and forwards run/publish only on explicit operations', async () => {
  let current = null;
  const calls = [];
  const facade = new NativeBuildFacade({ peek: () => current, call: async (...args) => { calls.push(args); return 'started'; } });
  assert.equal(facade.contexts, null);
  assert.equal(facade.profiles, null);
  assert.equal(facade.tests, null);
  assert.deepEqual(calls, []);
  current = { contexts: { setProject() {} }, profiles: {}, tests: {} };
  assert.equal(facade.contexts, current.contexts);
  assert.equal(await facade.runProject(), 'started');
  assert.equal(await facade.publishProfile(), 'started');
  assert.deepEqual(calls.map(call => call[0]), ['runProject', 'publishProfile']);
});
