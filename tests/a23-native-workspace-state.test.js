import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyNativeProjectContext, createNativeContextHooks, nativeCompilationRequest, nativeDocumentReadOnly
} from '../apps/studio/native-build/workspace-state.js';

test('context application preserves edits made while reads are in flight and keeps generated source immutable', () => {
  const state = {nativeMode: true, files: [{uri: 'A.cs', text: 'local', version: 9, nativeBaseline: 'base', nativeHash: 'old'}],
    tabs: ['A.cs'], active: 'A.cs', revision: 1};
  applyNativeProjectContext(state, {context: {id: 'id', properties: {}, project: 'A.csproj'}, compilation: {
    options: {}, files: [{uri: 'A.cs', text: 'remote', hash: 'new'}, {uri: 'A.g.cs', text: 'generated', generated: true}]
  }});
  assert.equal(state.files[0].text, 'local');
  assert.equal(state.files[0].nativeHash, 'old');
  assert.equal(state.files[1].readOnly, true);
  assert.equal(nativeCompilationRequest({...state, nativeMode: false}), null);
  assert.throws(() => applyNativeProjectContext({...state, nativeMode: false}, {}), /Attach/);
});

test('semantic requests retain the selected context, reference bytes and auxiliary files without selecting every open document', () => {
  const references = [{display: 'Contract', bytes: new Uint8Array([1, 2])}];
  const additionalFiles = [{path: 'config.json', text: '{}'}];
  const analyzerConfigFiles = [{path: '.editorconfig'}];
  const selected = {uri: 'App/Main.cs', text: 'source', version: 4};
  const state = {nativeMode: true, files: [selected, {uri: 'Other.cs', text: 'other'}],
    nativeContextFiles: ['App/Main.cs'], nativeCompilationOptions: {outputKind: 'exe', references},
    nativeAdditionalFiles: additionalFiles,
    nativeProjectContext: {id: 'net10', properties: {assemblyname: 'App'}, analyzerConfigFiles}};
  const request = nativeCompilationRequest(state);
  assert.deepEqual(request.files, [selected]);
  assert.notEqual(request.files[0], selected);
  assert.equal(request.compilationOptions.references, references);
  assert.equal(request.additionalFiles, additionalFiles);
  assert.equal(request.analyzerConfigFiles, analyzerConfigFiles);
  assert.equal(request.assemblyName, 'App');
  assert.equal(request.outputKind, 'exe');
  assert.equal(request.contextId, 'net10');
  assert.equal(nativeCompilationRequest({...state, nativeProjectContext: null}), null);
});

test('context changes retire obsolete generated documents and invalidate executable state while preserving ordinary open files', () => {
  const state = {nativeMode: true, files: [{uri: 'old.g.cs', text: 'old', generated: true},
    {uri: 'Open.cs', text: 'editor', version: 3}], tabs: ['old.g.cs', 'Open.cs'], active: 'old.g.cs',
    revision: 7, image: {}, assembly: new Uint8Array([1]), pdb: {}, ilDump: 'old', importedAssembly: true};
  const context = {id: 'new', project: 'App.csproj', langVersion: '12', properties: {AssemblyName: 'Native'},
    diagnostics: [{message: 'context'}]};
  const compilation = {files: [{path: 'Main.cs', text: 'current', hash: 'hash'},
    {uri: 'new.g.cs', text: 'generated', generated: true}], options: {defineConstants: ['ACTIVE']}};
  const request = applyNativeProjectContext(state, {context, compilation});
  assert.deepEqual(state.files.map(file => file.uri), ['Open.cs', 'Main.cs', 'new.g.cs']);
  assert.deepEqual(request.files.map(file => file.uri), ['Main.cs', 'new.g.cs']);
  assert.deepEqual(state.tabs, ['Open.cs', 'Main.cs']);
  assert.equal(state.active, 'Main.cs');
  assert.equal(state.files[1].nativeBaseline, 'current');
  assert.equal(state.files[1].nativeHash, 'hash');
  assert.equal(state.files[2].readOnly, true);
  assert.equal(state.revision, 8);
  assert.equal(state.buildDirty, true);
  assert.equal(state.importedAssembly, false);
  assert.equal(state.langVersion, '12');
  assert.equal(state.nativeStartup, 'App.csproj');
  assert.equal(state.nativeContextDiagnostics, context.diagnostics);
  for (const key of ['image', 'assembly', 'pdb', 'ilDump']) assert.equal(state[key], null);
});

test('document editability combines application, generated and individual readonly state', () => {
  assert.equal(nativeDocumentReadOnly({}, {uri: 'A.cs'}), false);
  assert.equal(nativeDocumentReadOnly({readOnly: true}, {readOnly: false}), true);
  assert.equal(nativeDocumentReadOnly({}, {generated: true, readOnly: false}), true);
  assert.equal(nativeDocumentReadOnly({}, {readOnly: true}), true);
  assert.equal(nativeDocumentReadOnly({}, null), false);
});

test('context hooks stop execution before applying and rendering a complete context', async () => {
  const calls = [];
  const state = {nativeMode: true, files: [], tabs: [], revision: 0};
  const hooks = createNativeContextHooks({state,
    stop: async () => { calls.push('stop'); await Promise.resolve(); },
    resetEditors: () => calls.push('editors'), renderWorkspace: () => calls.push('render'),
    scheduleAnalysis: () => calls.push('analysis'), status: value => calls.push(value)});
  await hooks.onProjectContext({context: {id: 'native', targetFramework: 'net10.0'},
    compilation: {files: [{uri: 'A.cs', text: ''}], options: {}}, signal: new AbortController().signal});
  assert.deepEqual(calls, ['stop', 'editors', 'render', 'analysis', 'Native context · net10.0 · 1 source files']);
  assert.equal(hooks.getTestInput().revision, 1);
  assert.equal(hooks.getTestInput().contextId, 'native');
  assert.deepEqual(hooks.getTestSources(), hooks.getTestInput().files);
});

test('cancellation while stopping execution cannot activate or render a new context', async () => {
  const controller = new AbortController();
  const state = {nativeMode: true, files: [], revision: 0};
  const calls = [];
  const hooks = createNativeContextHooks({state, stop: async () => controller.abort(),
    resetEditors: () => calls.push('editors'), renderWorkspace: () => calls.push('render')});
  await assert.rejects(hooks.onProjectContext({context: {id: 'cancelled'},
    compilation: {files: []}, signal: controller.signal}), error => error.name === 'AbortError');
  assert.equal(state.nativeProjectContext, undefined);
  assert.equal(state.revision, 0);
  assert.deepEqual(calls, []);
  assert.throws(() => applyNativeProjectContext(state, {context: {}, compilation: {files: []}}), /hydrated/);
});

test('portable test input callbacks retain their complete project preparation and cancellation options', () => {
  const options = {signal: new AbortController().signal};
  const prepared = {files: [], compilationOptions: {references: [{bytes: new Uint8Array([3])}]}};
  const state = {nativeMode: false, files: [{uri: 'A.cs', text: ''}], revision: 2, langVersion: '12'};
  const hooks = createNativeContextHooks({state, getTestInput: received => {
    assert.equal(received, options);
    return prepared;
  }});
  assert.equal(hooks.getTestInput(options), prepared);
  const fallback = createNativeContextHooks({state}).getTestInput(options);
  assert.deepEqual(fallback, {files: state.files, revision: 2, compilationOptions: {langVersion: '12'}});
  assert.notEqual(fallback.files[0], state.files[0]);
});
