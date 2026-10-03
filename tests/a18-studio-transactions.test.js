import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {setDesignerSampleData} from '@sharpforge/designer';
import {designerSourceDocument} from '../apps/studio/designer-source-projection.js';
import {studioHarness, sourceState, ownerUri, constructionUri} from './fixtures/a18-studio-harness.js';

test('A18 Studio links a partial tab to its construction file and executes the worker-compiled edit on both VMs', async context => {
  const harness = await studioHarness(context);
  const initialOwner = harness.file(ownerUri).text;
  const linked = await harness.connect();
  assert.equal(linked.uri, constructionUri);
  assert.equal(harness.view.session.uri, ownerUri);
  assert.equal(harness.sync.file().uri, constructionUri);
  assert.equal(harness.sync.protocol.source.version, 1);
  assert.equal(harness.sync.session.analysis.compilationSucceeded, true);
  assert.deepEqual(harness.compiler.requests[0].uris, ['App/View.cs', 'App/View.g.cs', 'App/Program.cs']);
  harness.document.setProperty('Width', 215, ['action']);
  assert.equal(harness.sync.dirty(), true);
  assert.equal(harness.file(constructionUri).version, 1);
  const written = await harness.sync.write();
  assert.equal(written.state, 'synced');
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.file(ownerUri).text, initialOwner);
  assert.match(harness.file(constructionUri).text, /Width = 215/);
  assert.equal(harness.file(constructionUri).version, 2);
  assert.equal(harness.history.past[0].uri, ownerUri);
  assert.equal(harness.applied.length, 1);
  const compiled = await harness.build();
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    const action = vm.platform.scene().nodes.find(node => node.properties.Name === 'Action');
    assert.equal(action.properties.Width, 215);
    assert.equal(action.properties.Content, 'Run');
  }
});

test('A18 Studio commits a partial-field rename atomically and restores both editor histories with its owning design', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  const original = sourceState(harness);
  harness.document.setProperty('Name', 'CommandButton', ['action']);
  await harness.sync.write();
  assert.equal(harness.history.past.length, 1);
  const entry = harness.history.past[0];
  assert.equal(entry.uri, ownerUri);
  assert.deepEqual(entry.changes.map(change => change.uri).sort(), [ownerUri, constructionUri].sort());
  assert.equal(harness.applied.length, 1);
  assert.deepEqual([...new Set(harness.applied[0].map(edit => edit.uri))].sort(), [ownerUri, constructionUri].sort());
  assert.match(harness.file(ownerUri).text, /static Button CommandButton;/);
  assert.match(harness.file(ownerUri).text, /CommandButton.Content = "Clicked"/);
  assert.match(harness.file(constructionUri).text, /Name = "CommandButton"/);
  assert.equal(entry.afterAnalysis.compilationSucceeded, true);
  assert.equal(harness.history.undo(ownerUri), true);
  assert.deepEqual(harness.state.files.map(file => file.text), original.files.map(file => file.text));
  assert.equal(harness.document.node('action').properties.Name, 'Action');
  assert.equal(harness.restored[0].uri, ownerUri);
  assert.equal(harness.sync.state, 'synced');
  const restoredEditors = sourceState(harness).editors;
  for (const uri of [ownerUri, constructionUri]) {
    const editor = harness.editors.get(uri);
    assert.deepEqual(restoredEditors[uri], original.editors[uri]);
    assert.equal(editor.cursorUpdates, 1);
  }
  assert.equal(harness.history.undo(constructionUri, true), true);
  assert.equal(harness.document.node('action').properties.Name, 'CommandButton');
  assert.match(harness.file(ownerUri).text, /CommandButton.Width = 240/);
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.history.future.length, 0);
});

test('A18 Studio source parse errors preserve the exact last valid preview until repaired source compiles', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  const before = harness.document.serialize();
  const preview = structuredClone(harness.sync.protocol.lastValidPreview);
  const previewCount = harness.previews.length;
  const original = harness.file(constructionUri).text;
  harness.type(constructionUri, original.replace('Width = 160', 'Width = '));
  assert.equal(harness.sync.state, 'source-dirty');
  const blocked = await harness.sync.read();
  assert.equal(blocked.state, 'blocked');
  assert(blocked.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
  assert.equal(harness.document.serialize(), before);
  assert.deepEqual(harness.sync.protocol.lastValidPreview, preview);
  assert.equal(harness.previews.length, previewCount);
  assert.match(harness.file(constructionUri).text, /Width = ,/);
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.history.past.length, 0);
  harness.type(constructionUri, original.replace('Width = 160', 'Width = 176'));
  const repaired = await harness.sync.read();
  assert.equal(repaired.state, 'synced');
  assert.equal(harness.document.node('action').properties.Width, 176);
  assert.equal(harness.previews.at(-1).nodes.find(node => node.id === 'action').properties.Width, 176);
});

test('A18 Studio rejects a completed multi-file worker plan if the workspace changes before source commit', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  harness.document.setProperty('Name', 'CommandButton', ['action']);
  let afterExternalEdit;
  let compiledPlan;
  harness.compiler.afterResponse = (method, params, result) => {
    if (method !== 'designAnalyze' || params.operation !== 'plan') return;
    harness.compiler.afterResponse = null;
    compiledPlan = result;
    harness.type(ownerUri, harness.file(ownerUri).text + '\n// Concurrent editor change', {notifyChange: false});
    afterExternalEdit = sourceState(harness);
  };
  await assert.rejects(harness.sync.write(), /Workspace changed|dependency changed|changed during compilation/i);
  assert.equal(compiledPlan.success, true);
  assert.equal(compiledPlan.changes.length, 2);
  assert.deepEqual(sourceState(harness), afterExternalEdit);
  assert.equal(harness.document.node('action').properties.Name, 'CommandButton');
  assert.equal(harness.sync.dirty(), true);
  assert.equal(harness.sync.state, 'blocked');
});

test('A18 source-service preflight rejects changed dependencies and read-only secondary files before any editor mutation', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  harness.document.setProperty('Name', 'CommandButton', ['action']);
  const plan = await harness.plan();
  assert.equal(plan.success, true);
  assert.equal(plan.changes.length, 2);
  const primaryVersion = harness.file(constructionUri).version;
  harness.file(ownerUri).readOnly = true;
  let before = sourceState(harness);
  let callbacks = 0;
  await assert.rejects(harness.services.applySourceEdits(constructionUri, plan, primaryVersion, () => callbacks++, ownerUri), /read-only/);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(callbacks, 0);
  harness.file(ownerUri).readOnly = false;
  harness.type(ownerUri, harness.file(ownerUri).text + '\n// New version', {notifyChange: false, bumpRevision: false});
  before = sourceState(harness);
  await assert.rejects(harness.services.applySourceEdits(constructionUri, plan, primaryVersion, () => callbacks++, ownerUri), /dependency changed/i);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(callbacks, 0);
});

test('A18 unqualified editor plans pass the real compiler validation handler and cannot stage a type error', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  harness.document.setProperty('Width', 201, ['action']);
  const plan = await harness.plan();
  assert.equal(plan.success, true);
  assert.equal(plan.changes.length, 1);
  const invalid = structuredClone(plan);
  delete invalid.success;
  const change = invalid.changes[0];
  const edit = change.edits.find(item => item.text === '201');
  assert(edit, 'The real source planner must own the requested Width literal');
  edit.text = '"not a number"';
  change.text = change.before;
  for (const item of [...change.edits].sort((left, right) => right.start - left.start)) {
    change.text = change.text.slice(0, item.start) + item.text + change.text.slice(item.end);
  }
  invalid.text = change.text;
  const before = sourceState(harness);
  let callbacks = 0;
  await assert.rejects(harness.services.applySourceEdits(constructionUri, invalid, 1, () => callbacks++, ownerUri),
    error => error.code === 'SFSYNC_COMPILE');
  assert(harness.compiler.requests.some(request => request.method === 'validateDesigner'));
  assert.deepEqual(sourceState(harness), before);
  assert.equal(callbacks, 0);
  const active = await harness.build();
  assert.equal(active.success, true, JSON.stringify(active.diagnostics));
});

test('A18 ordinary source typing remains outside the preceding atomic designer undo boundary', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  harness.document.setProperty('Name', 'CommandButton', ['action']);
  await harness.sync.write();
  const boundary = harness.file(ownerUri).text;
  harness.type(ownerUri, boundary + '\n// Ordinary typing');
  const afterTyping = sourceState(harness);
  assert.equal(harness.history.canUndo(ownerUri), false);
  assert.equal(harness.history.undo(ownerUri), false);
  assert.deepEqual(sourceState(harness), afterTyping);
  assert.equal(harness.document.node('action').properties.Name, 'CommandButton');
  harness.type(ownerUri, boundary);
  assert.equal(harness.history.canUndo(ownerUri), true);
  assert.equal(harness.history.undo(ownerUri), true);
  assert.equal(harness.document.node('action').properties.Name, 'Action');
  assert.match(harness.file(ownerUri).text, /static Button action;/);
});

test('A18 multi-file history conflicts and read-only buffers reject the whole undo without falling through', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  harness.document.setProperty('Name', 'CommandButton', ['action']);
  await harness.sync.write();
  for (const key of ['readOnly', 'readonly']) {
    harness.file(constructionUri)[key] = true;
    const before = sourceState(harness);
    assert.equal(harness.history.canUndo(ownerUri), true);
    assert.throws(() => harness.history.undo(ownerUri), /changed independently/);
    assert.deepEqual(sourceState(harness), before);
    assert.equal(harness.history.applying, false);
    delete harness.file(constructionUri)[key];
  }
  harness.type(constructionUri, harness.file(constructionUri).text + '\n// Other document typing');
  const conflict = sourceState(harness);
  assert.throws(() => harness.history.undo(ownerUri), /changed independently/);
  assert.deepEqual(sourceState(harness), conflict);
  assert.equal(harness.history.past.length, 1);
  assert.equal(harness.document.node('action').properties.Name, 'CommandButton');
});

test('A18 preview metadata never dirties source and remains intact across source reads and atomic history restoration', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  const sourceBefore = sourceState(harness);
  setDesignerSampleData(harness.document, 'action', {properties: {Content: 'Design sample'}});
  harness.document.change('Editor metadata', design => {
    design.designerOptions = {zoom: 1.25};
    design.editorState = {tab: 'properties'};
    design.designer = {guides: {version: 1, gridSize: 8, gridVisible: true, snapGrid: true,
      snapGuides: true, snapSiblings: true, tolerance: 6, guides: []}};
    const node = design.nodes.find(item => item.id === 'action');
    node.runtimeId = 'running-action';
    node.baseProperties = {Content: 'Captured runtime fallback'};
  });
  assert.deepEqual(sourceState(harness), sourceBefore);
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.sync.state, 'synced');
  assert.equal(harness.sync.protocol.sourceDirty, false);
  const projected = designerSourceDocument(harness.document.value);
  for (const key of ['designer', 'designerOptions', 'editorState', 'designTime']) assert.equal(projected[key], undefined);
  assert.equal(projected.nodes.find(node => node.id === 'action').runtimeId, undefined);
  assert.equal(projected.nodes.find(node => node.id === 'action').baseProperties, undefined);
  const metadata = structuredClone(harness.document.value.designTime);
  harness.type(constructionUri, harness.file(constructionUri).text.replace('Width = 160', 'Width = 175'));
  await harness.sync.read();
  assert.equal(harness.document.node('action').properties.Width, 175);
  assert.deepEqual(harness.document.value.designTime, metadata);
  assert.equal(harness.document.node('action').runtimeId, 'running-action');
  harness.document.setProperty('Width', 250, ['action']);
  await harness.sync.write();
  setDesignerSampleData(harness.document, 'action', {properties: {Content: 'Latest designer sample'}});
  assert.equal(harness.history.undo(ownerUri), true);
  assert.equal(harness.document.node('action').properties.Width, 175);
  assert.equal(harness.document.value.designTime.nodes.action.properties.Content, 'Latest designer sample');
  assert.equal(harness.document.value.designerOptions.zoom, 1.25);
  assert.equal(harness.document.value.editorState.tab, 'properties');
  assert.equal(harness.document.node('action').runtimeId, 'running-action');
  assert.equal(harness.sync.dirty(), false);
  for (const file of harness.state.files) assert.doesNotMatch(file.text, /Latest designer sample|running-action|designerOptions/);
});

for (const [name, subscription, count, target] of [
  ['lambda', 'action.Click += (sender, args) => { action.Content = "Lambda"; };', 1, constructionUri],
  ['multiple', 'action.Click += OnClick; action.Click += OnOther;', 2, ownerUri]
]) {
  test(`A18 protected ${name} event navigation uses the production worker and never writes source`, async context => {
    const harness = await studioHarness(context, {subscription});
    await harness.connect();
    const event = harness.sync.session.analysis.bindings.action.events.Click;
    assert.equal(event.capability, 'navigate');
    assert.equal(event.subscriptions.length, count);
    const before = sourceState(harness);
    const document = harness.document.serialize();
    harness.state.readOnly = true;
    const result = await harness.sync.navigateEvent('action', 'Click');
    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.existing, true);
    assert.equal(result.changes.length, 0);
    assert.deepEqual(sourceState(harness), before);
    assert.equal(harness.document.serialize(), document);
    assert.equal(harness.view.documentHost.mode, 'code');
    assert.equal(harness.navigation.length, 1);
    const location = harness.navigation[0];
    assert.equal(location.uri, target);
    const text = harness.file(target).text.slice(location.start, location.end);
    assert.match(text, name === 'lambda' ? /=>/ : /OnClick/);
    assert(harness.compiler.requests.some(request => request.method === 'designAnalyze' && request.operation === 'event'));
  });
}
