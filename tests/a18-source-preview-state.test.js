import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, DesignSyncProtocol, createDesign, createDesignerResourceDocument, generateDesignerResourceClass} from '@sharpforge/designer';
import {sourcePreviewHarness, componentSource} from './fixtures/a18-component-preview.js';

test('read-only source models reject edits, undo and active gestures while permitting selection, refresh and explicit unlock', () => {
  const document = new DesignDocument(createDesign());
  const root = 'canvas';
  document.setProperty('Width', 700, [root]);
  const transaction = document.beginTransaction('gesture');
  transaction.stage(candidate => { candidate.nodes.find(node => node.id === root).properties.Width = 720; });
  document.setReadOnly(true, 'Repair C# to resume authoring');
  for (const edit of [() => document.setProperty('Width', 800), () => document.undo(), () => document.beginTransaction('new')]) {
    assert.throws(edit, {code: 'SFD1865'});
  }
  assert.throws(() => transaction.commit(), /closed/);
  assert.equal(document.node(root).properties.Width, 700);
  document.select([root]);
  document.load(document.snapshot(), {history: false});
  assert.equal(document.readOnly, true);
  document.setReadOnly(false);
  document.setProperty('Width', 800, [root]);
  assert.equal(document.node(root).properties.Width, 800);
  document.dispose();
});

test('failed source previews advance through an explicit capability while strict acceptance and source writes stay blocked', () => {
  const document = createDesign();
  const protocol = new DesignSyncProtocol({uri: 'View.cs', sourceText: 'one', document});
  const diagnostics = [{code: 'SF2200', severity: 'error', message: 'Inherited classes require another runtime profile'}];
  protocol.sourceChanged('two');
  const rejected = protocol.accept(protocol.begin('source'), {document, success: false, diagnostics});
  assert.equal(rejected.accepted, false);
  assert.equal(protocol.sourceDirty, true);
  const capability = {kind: 'component', previewAvailable: true, readOnly: true, sourceWrites: false};
  const accepted = protocol.acceptPreview(protocol.begin('source'), {document, success: false, capability, diagnostics});
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state, 'blocked');
  assert.equal(protocol.sourceDirty, false);
  assert.equal(protocol.snapshot().diagnostic.code, 'SF2200');
  assert.throws(() => protocol.acceptPreview(protocol.begin('design'), {document, success: false, capability}), {code: 'SFSYNC_ARGUMENT'});
  protocol.dispose();
});

test('resource preview capabilities permit staged authoring without claiming source writes or clearing errors', () => {
  const document = createDesign();
  const protocol = new DesignSyncProtocol({uri: 'Resources.cs', document});
  const capability = {kind: 'resources', previewAvailable: true, readOnly: false, stageDesign: true, sourceWrites: false};
  const diagnostics = [{code: 'SFD1884', severity: 'error', message: 'Native compilation is required'}];
  assert.equal(protocol.acceptPreview(protocol.begin('source'), {document, success: false, capability, diagnostics}).accepted, true);
  protocol.designChanged({...document, name: 'Staged resource preview'});
  assert.equal(protocol.designDirty, true);
  assert.equal(protocol.sourceDirty, false);
  assert.throws(() => protocol.acceptPreview(protocol.begin('source', {resolution: 'source'}), {
    document, success: false, capability: {...capability, stageDesign: false}, diagnostics
  }), {code: 'SFSYNC_ARGUMENT'});
  protocol.dispose();
});

test('Studio inherited previews refresh with errors retained and unlock only after the repaired source compiles', async context => {
  const scope = sourcePreviewHarness(context);
  const initial = await scope.sync.connect();
  assert.equal(initial.state, 'blocked');
  assert.equal(initial.readOnly, true);
  assert.equal(scope.document.readOnly, true);
  assert.equal(scope.sync.protocol.state, 'blocked');
  assert.equal(scope.catalogs[0].success, false);
  assert.equal(scope.catalogs[0].previewAvailable, true);
  assert.throws(() => scope.document.setProperty('Width', 160, ['action']), {code: 'SFD1865'});
  await assert.rejects(scope.sync.write(), {code: 'SFSYNC_COMPILE'});
  scope.type(componentSource.replace('Width = 120', 'Width = 180'));
  await scope.sync.read();
  assert.equal(scope.document.node('action').properties.Width, 180);
  assert.equal(scope.sync.protocol.sourceDirty, false);
  assert.equal(scope.sync.protocol.state, 'blocked');
  assert.ok(scope.sync.diagnostics.some(diagnostic => diagnostic.code === 'SF2200' && diagnostic.severity === 'error'));
  const valid = scope.document.serialize();
  scope.type(componentSource.replace('Width = 120', 'Width = missing'));
  await scope.sync.read();
  assert.equal(scope.document.serialize(), valid);
  const repaired = componentSource.replace(' : UserControl', '').replace('this.Content = root;', '');
  scope.type(repaired);
  await scope.sync.read();
  assert.equal(scope.sync.session.analysis.compilationSucceeded, true);
  assert.equal(scope.sync.state, 'synced');
  assert.equal(scope.document.readOnly, false);
  scope.document.setProperty('Width', 200, ['action']);
  assert.equal(scope.sync.dirty(), true);
  assert.ok(scope.compiler.requests.every(request => request.method !== 'designAnalyze' || request.params.operation === 'analyze'));
  assert.ok(scope.compiler.requests[0].signal instanceof AbortSignal);
  assert.equal(Object.hasOwn(scope.compiler.requests[0].params, 'signal'), false);
});

function resourceSource(value) {
  const document = createDesignerResourceDocument({name: 'Resources', resources: {Count: {type: 'int', value}}});
  try { return generateDesignerResourceClass(document.value); }
  finally { document.dispose(); }
}

test('Studio guarded resource refresh advances the preview baseline and keeps the document stage-editable', async context => {
  const scope = sourcePreviewHarness(context, {uri: 'Resources.cs', resource: true,
    files: [{uri: 'Resources.cs', text: resourceSource(1), version: 1}]});
  await scope.sync.connect();
  assert.equal(scope.document.readOnly, false);
  assert.equal(scope.sync.session.analysis.canApply, false);
  assert.equal(scope.sync.protocol.state, 'blocked');
  scope.type(resourceSource(2));
  await scope.sync.read();
  assert.equal(scope.document.value.resources.Count.value, 2);
  assert.equal(scope.sync.protocol.sourceDirty, false);
  assert.equal(scope.sync.state, 'blocked');
  scope.document.change('Stage value', candidate => { candidate.resources.Count.value = 3; });
  assert.equal(scope.sync.dirty(), true);
  const plan = await scope.sync.planCandidate();
  assert.equal(plan.analysis.document.resources.Count.value, 3);
  assert.equal(plan.canApply, false);
  assert.equal(scope.state.files[0].text, resourceSource(2));
});
