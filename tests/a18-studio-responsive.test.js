import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {setResponsiveState} from '@sharpforge/designer';
import {studioHarness, sourceState, ownerUri, constructionUri} from './fixtures/a18-studio-harness.js';

const helper = `
    // Keep this helper's explanation and both unrelated event methods.
    public static void ApplyAdaptive(double width) {
        // SharpForge adaptive states v1: ["Wide","Compact"]
        action.Width = 160; // the authored baseline
        if (width >= 600.0) {
            action.Width = 240; // wide viewport
            return;
        }
        if (width >= 0.0 && width < 600.0) {
            action.Width = 100;
            return;
        }
    }
`;

async function adaptiveHarness(context) {
  const harness = await studioHarness(context);
  const owner = harness.file(ownerUri);
  const construction = harness.file(constructionUri);
  owner.text = owner.text.slice(0, -1) + helper + '}';
  construction.text = construction.text.replace('return window;', 'ApplyAdaptive(480.0);\n        return window;');
  await harness.connect();
  return harness;
}

async function assertCompiledWidth(harness, name, width) {
  const compiled = await harness.build();
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const Machine of [VirtualMachine, CilVirtualMachine]) {
    const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', Machine.name + ': ' + JSON.stringify(result.fault));
    const action = machine.platform.scene().nodes.find(node => node.properties.Name === name);
    assert(action, 'The worker-compiled application must materialize the requested named control');
    assert.equal(action.properties.Width, width, Machine.name);
  }
}

test('A18 Studio adaptive edits compile across partial files and undo/redo source, state identities and editor histories together', async context => {
  const harness = await adaptiveHarness(context);
  assert.equal(harness.sync.session.analysis.uri, constructionUri);
  assert.equal(harness.sync.session.analysis.compilationSucceeded, true);
  assert.equal(harness.document.value.width, 480);
  assert.equal(harness.document.node('action').properties.Width, 160);
  assert.deepEqual(harness.document.value.responsive.states.map(state => state.id), ['Compact', 'Wide']);
  const original = sourceState(harness);
  const originalDocument = harness.document.snapshot();
  await assertCompiledWidth(harness, 'Action', 100);
  harness.document.change('Edit responsive source', document => {
    const action = document.nodes.find(node => node.id === 'action');
    action.properties.Name = 'ResponsiveAction';
    action.properties.Width = 180;
    document.width = 800;
    document.responsive.states[1].overrides.action.Width = 300;
  });
  assert.equal(harness.sync.dirty(), true);
  const written = await harness.sync.write();
  assert.equal(written.state, 'synced');
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.history.past.length, 1);
  assert.equal(harness.applied.length, 1);
  assert.deepEqual(new Set(harness.applied[0].map(edit => edit.uri)), new Set([ownerUri, constructionUri]));
  assert.equal(harness.history.past[0].afterAnalysis.compilationSucceeded, true);
  assert.match(harness.file(ownerUri).text, /ResponsiveAction.Width = 180; \/\/ the authored baseline/);
  assert.match(harness.file(ownerUri).text, /ResponsiveAction.Width = 300; \/\/ wide viewport/);
  assert.match(harness.file(ownerUri).text, /ResponsiveAction.Content = "Clicked"/);
  assert.match(harness.file(constructionUri).text, /ApplyAdaptive\(800.0\);/);
  assert.equal(harness.document.value.responsive.states[1].overrides.action.Width, 300);
  await assertCompiledWidth(harness, 'ResponsiveAction', 300);
  const changedText = harness.state.files.map(file => file.text);
  assert.equal(harness.history.undo(ownerUri), true);
  assert.deepEqual(harness.state.files.map(file => file.text), original.files.map(file => file.text));
  assert.deepEqual(harness.document.snapshot(), originalDocument);
  assert.equal(harness.sync.state, 'synced');
  const restored = sourceState(harness);
  for (const uri of [ownerUri, constructionUri]) assert.deepEqual(restored.editors[uri], original.editors[uri]);
  await assertCompiledWidth(harness, 'Action', 100);
  assert.equal(harness.history.undo(constructionUri, true), true);
  assert.deepEqual(harness.state.files.map(file => file.text), changedText);
  assert.equal(harness.document.node('action').properties.Name, 'ResponsiveAction');
  assert.equal(harness.document.value.responsive.states[1].overrides.action.Width, 300);
  assert.equal(harness.sync.dirty(), false);
  await assertCompiledWidth(harness, 'ResponsiveAction', 300);
});

test('A18 Studio authoring a first adaptive state creates owned C# and reopens it without source dirtiness', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  assert.equal(harness.document.value.responsive, undefined);
  const before = harness.state.files.map(file => file.text);
  setResponsiveState(harness.document, {id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 280}}});
  assert.equal(harness.sync.state, 'design-dirty');
  await harness.sync.write();
  assert.equal(harness.sync.state, 'synced');
  assert.match(harness.file(constructionUri).text, /SharpForge adaptive states v1: \["Wide"\]/);
  assert.equal(harness.document.value.responsive.states[0].overrides.action.Width, 280);
  assert.equal(harness.applied.length, 1);
  await assertCompiledWidth(harness, 'Action', 280);
  await harness.sync.connect(ownerUri);
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.document.value.responsive.states[0].overrides.action.Width, 280);
  assert.equal(harness.history.undo(ownerUri), true);
  assert.deepEqual(harness.state.files.map(file => file.text), before);
  assert.equal(harness.document.value.responsive, undefined);
  await assertCompiledWidth(harness, 'Action', 160);
});

test('A18 an edited adaptive helper retains the last valid Studio preview and never becomes an accepted source baseline', async context => {
  const harness = await adaptiveHarness(context);
  const original = harness.file(ownerUri).text;
  const document = harness.document.serialize();
  const preview = structuredClone(harness.sync.protocol.lastValidPreview);
  const previewCount = harness.previews.length;
  harness.type(ownerUri, original.replace('action.Width = 160; // the authored baseline',
    'action.Width = Math.Max(100.0, 160.0); // the authored baseline'));
  assert.equal(harness.sync.state, 'source-dirty');
  const result = await harness.sync.read();
  assert.equal(result.state, 'blocked');
  assert(result.diagnostics.some(diagnostic => diagnostic.code === 'SFD0004' || diagnostic.legacyCode === 'SFSYNC_OWNERSHIP'));
  assert.equal(harness.document.serialize(), document);
  assert.deepEqual(harness.sync.protocol.lastValidPreview, preview);
  assert.equal(harness.previews.length, previewCount);
  assert.equal(harness.history.past.length, 0);
  assert.equal(harness.applied.length, 0);
  harness.type(ownerUri, original.replace('action.Width = 240; // wide viewport', 'action.Width = 260; // wide viewport'));
  const repaired = await harness.sync.read();
  assert.equal(repaired.state, 'synced');
  assert.equal(harness.document.value.responsive.states[1].overrides.action.Width, 260);
  assert.equal(harness.document.node('action').properties.Width, 160);
  assert.equal(harness.sync.dirty(), false);
});

test('A18 a stale completed adaptive plan cannot partially change either owning source file', async context => {
  const harness = await adaptiveHarness(context);
  harness.document.change('Update adaptive baseline', document => {
    document.nodes.find(node => node.id === 'action').properties.Width = 175;
    document.responsive.states[1].overrides.action.Width = 275;
  });
  let snapshot;
  let compiledPlan;
  harness.compiler.afterResponse = (method, params, result) => {
    if (method !== 'designAnalyze' || params.operation !== 'plan') return;
    harness.compiler.afterResponse = null;
    compiledPlan = result;
    harness.type(ownerUri, harness.file(ownerUri).text + '\n// Independent partial-file edit', {notifyChange: false});
    snapshot = sourceState(harness);
  };
  await assert.rejects(harness.sync.write(), /Workspace changed|dependency changed|changed during compilation/i);
  assert.equal(compiledPlan.success, true);
  assert.deepEqual(new Set(compiledPlan.changes.map(change => change.uri)), new Set([ownerUri, constructionUri]));
  assert.deepEqual(sourceState(harness), snapshot);
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.history.past.length, 0);
  assert.equal(harness.sync.dirty(), true);
  assert.equal(harness.document.value.responsive.states[1].overrides.action.Width, 275);
  assert.equal(harness.document.node('action').properties.Width, 175);
});
