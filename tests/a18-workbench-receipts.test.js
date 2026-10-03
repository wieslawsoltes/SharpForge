import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, validateDesign, guideSettings} from '@sharpforge/designer';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {DesignerWorkbench} from '../apps/studio/designer-workbench.js';
import {studioHarness, ownerUri} from './fixtures/a18-studio-harness.js';

/** Host/editor boundaries are explicit; compilation tests use the registered production compiler worker. */
function contextFor(state, overrides = {}) {
  const preferences = new Map();
  const registrations = new Map();
  const automations = new Map();
  const calls = {renderTree: 0, saveLocal: 0, opened: [], errors: []};
  const context = {
    state, editors: new Map(), settings: {getItem: key => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value)},
    compiler: {request: () => { throw new Error('This test did not supply a compiler service'); }},
    applyEdits: () => { throw new Error('No source edits are expected'); },
    runtimeRequest: () => { throw new Error('No runtime message is expected'); }, requestCompiler() {},
    selectVisual() {}, runtimeOptions: () => ({}), records: () => [...state.files, ...(state.extraFiles ?? [])],
    docking: {content: new Map()}, hostDocument: null, saveSoon() {}, renderPanel() {},
    toast: (message, severity) => calls.errors.push({message, severity}),
    renderTree: () => calls.renderTree++, saveLocal: () => calls.saveLocal++,
    openSource: uri => calls.opened.push(uri),
    commandRegistry: {registerCommand: (id, _label, _shortcut, action) => {
      registrations.set(id, action);
      return () => registrations.delete(id);
    }},
    automation: {contributeAutomation: (name, actions) => {
      automations.set(name, actions);
      return () => automations.delete(name);
    }},
    ...overrides
  };
  return {context, calls, registrations, automations};
}

test('A18 Workbench compilation receipts retain the exact owning-project snapshot while the workspace changes during a real build', async context => {
  const harness = await studioHarness(context);
  const state = harness.state;
  const selectedUris = state.files.filter(file => file.uri.startsWith('App/')).map(file => file.uri);
  state.active = 'Other/Noise.cs';
  const {context: services} = contextFor(state, {compiler: harness.compiler, editors: harness.editors});
  const workbench = new DesignerWorkbench(services);
  context.after(() => workbench.dispose());
  const host = workbench.getAppHost();
  let compiled;
  harness.compiler.afterResponse = (method, params, result) => {
    assert.equal(method, 'build');
    assert.equal(params.compilationOptions.outputKind, 'exe');
    assert.deepEqual(params.files.map(file => file.uri), selectedUris);
    compiled = result;
    state.files.find(file => file.uri === ownerUri).uri = 'Other/Moved.cs';
    state.files.push({uri: 'App/AddedWhileCompiling.cs', text: 'This new member does not compile {', version: 1});
    state.revision++;
  };
  const receipt = await host.compile({uri: ownerUri});
  harness.compiler.afterResponse = null;
  assert.equal(receipt.success, true, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.compilationUris, selectedUris);
  assert.equal(receipt.image, compiled.image);
  assert.equal(receipt.assembly, compiled.assembly);
  assert.equal(state.startupProject, 'Other/Other.csproj');
  assert.equal(state.active, 'Other/Noise.cs');
  const workspaceSources = host.sourceFiles();
  assert.deepEqual(workspaceSources.map(file => file.uri), state.files.map(file => file.uri));
  assert(workspaceSources.some(file => file.uri === 'Other/Noise.cs'));
  assert(workspaceSources.some(file => file.uri === 'App/AddedWhileCompiling.cs'));
  workspaceSources[0].text = 'Mutated caller copy';
  assert.notEqual(state.files[0].text, 'Mutated caller copy');
  for (const vm of [new VirtualMachine(receipt.image), new CilVirtualMachine(receipt.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.platform.scene().nodes.find(node => node.properties.Name === 'Action').properties.Width, 160);
  }
  const failure = await host.compile({uri: 'Other/Noise.cs'});
  assert.equal(failure.success, false);
  assert(failure.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  assert.equal(failure.compilationUris, undefined);
});

test('A18 Workbench legacy live-session bridge uses the runtime context and falls back only when it is absent', context => {
  const state = {name: 'Runtime context', revision: 1, files: [], active: null,
    debug: {sessionId: 'debug-fallback', generation: 1, uiActive: true, state: 'paused'}};
  let runtime = {sessionId: 'host-runtime', generation: 3, uiActive: true, state: 'terminated', profile: 'cil'};
  const {context: services} = contextFor(state, {runtimeState: () => runtime});
  const workbench = new DesignerWorkbench(services);
  context.after(() => workbench.dispose());
  workbench.apps.refresh();
  assert.equal(workbench.apps.registry.get('host-runtime').generation, 3);
  assert.equal(workbench.apps.registry.get('debug-fallback'), null);
  runtime = {...runtime, generation: 4};
  workbench.apps.refresh();
  assert.equal(workbench.apps.registry.get('host-runtime').generation, 4);
  assert.throws(() => workbench.apps.registry.resolve('host-runtime', 3), /closed or restarted/);
  runtime = null;
  workbench.apps.refresh();
  assert.equal(workbench.apps.registry.get('host-runtime'), null);
  assert.equal(workbench.apps.registry.get('debug-fallback').generation, 1);
});

test('A18 Workbench initializes guide defaults before new-file persistence and ordinary saves preserve their existing metadata', async context => {
  const state = {name: 'Creation boundary', revision: 1, diskRevision: 1, files: [], extraFiles: [], dirtyFiles: new Set()};
  const openingError = new Error('Explicit source-view mounting boundary');
  const {context: services, calls} = contextFor(state, {openSource: () => { throw openingError; }});
  const workbench = new DesignerWorkbench(services);
  context.after(() => workbench.dispose());
  workbench.options.update({snap: 24});
  const fresh = createDesign('Fresh');
  const before = structuredClone(fresh);
  await assert.rejects(workbench.fileServices.createDesignDocument(fresh, 'Fresh.sfdesign.json'), error => error === openingError);
  const created = validateDesign(JSON.parse(state.extraFiles.find(file => file.path === 'Fresh.sfdesign.json').text));
  assert.equal(guideSettings(created).gridSize, 24);
  assert.deepEqual(fresh, before);
  assert.equal(calls.renderTree, 1);
  assert.equal(calls.saveLocal, 1);
  const existing = createDesign('Existing');
  await workbench.fileServices.saveDocument('Existing.sfdesign.json', JSON.stringify(existing));
  const saved = JSON.parse(state.extraFiles.find(file => file.path === 'Existing.sfdesign.json').text);
  assert.equal(saved.designer?.guides, undefined);
  const preserved = createDesign('Preserved');
  preserved.designer = {guides: {gridSize: 4}};
  await assert.rejects(workbench.fileServices.createDesignDocument(preserved, 'Preserved.sfdesign.json'), error => error === openingError);
  const record = JSON.parse(state.extraFiles.find(file => file.path === 'Preserved.sfdesign.json').text);
  assert.equal(guideSettings(record).gridSize, 4);
  assert.deepEqual(state.files, []);
  assert.deepEqual(calls.errors, []);
});
