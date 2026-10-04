import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, DesignDocument, DesignPreviewEnvironment, createDesignerResourceDocument, designScene} from '@sharpforge/designer';
import {DesignerTools} from '../apps/studio/designer-tools.js';
import {DesignerDocumentUpdates} from '../apps/studio/designer-document-updates.js';
import {DesignerResourceController} from '../apps/studio/designer-resource-view.js';
import {createDesignerActions} from '../apps/studio/designer-actions.js';

/** Retain real Tools/model transitions while supplying only the owning app and gesture boundaries. */
function lifecycleView(model) {
  const view = Object.create(DesignerTools.prototype);
  const trace = [];
  let expected = model;
  let transaction = null;
  Object.assign(view, {session: {document: model, kind: 'design'}, initialized: false, disposed: false,
    sourceSync: {session: null, designChanged() {}}, docking: {content: new Map()},
    chrome: {renderSelection() {}}, resourceContext: {renderPanel: () => true}});
  const record = kind => {
    assert.equal(view.document, expected, 'Cancel ' + kind + ' while its old document is active');
    assert.equal(expected.disposed, false, 'Cancel before the document is disposed');
    trace.push(kind);
  };
  view.surface = {
    preview: new DesignPreviewEnvironment(),
    cancelPointer() { record('pointer'); },
    finishKeyboard(cancel) { assert.equal(cancel, true); record('keyboard'); transaction?.cancel(); transaction = null; },
    text: {cancel() { record('text'); }}
  };
  view.updates = new DesignerDocumentUpdates(view);
  const arm = document => {
    expected = document;
    transaction = document.beginTransaction('Pending keyboard edit');
    transaction.stage(design => { design.width += 100; });
  };
  return {view, trace, arm, expect: document => { expected = document; }};
}

test('A18 Tools replacement cancels pending surface edits against the old model before disposal', () => {
  const model = new DesignDocument(createDesign('Old'));
  const {view, trace, arm} = lifecycleView(model);
  arm(model);
  view.replace(createDesign('New'), {path: 'New.sfdesign.json'});
  assert.deepEqual(trace, ['pointer', 'keyboard', 'text']);
  assert.equal(model.disposed, true);
  assert.equal(model.transaction, null);
  assert.equal(view.document.value.name, 'New');
  assert.equal(view.document.undoStack.length, 0);
  assert.equal(view.document.value.width, createDesign('New').width);
  assert.equal(view.updates.document, null, 'Replacing an unmounted view must not publish mounted projections.');
  view.modelSubscription();
  view.updates.dispose();
  view.document.dispose();
});

test('A18 template enter and apply cancel drafts before capture/commit and dispose the isolated document after leaving', () => {
  const owner = createDesignerResourceDocument({templates: {Frame: {targetType: 'Button',
    root: {id: 'frame', type: 'Border', properties: {Padding: 4}, children: []}}}});
  const harness = lifecycleView(owner);
  const {view, trace} = harness;
  view.resources = new DesignerResourceController(view);
  harness.arm(owner);
  const scope = view.resources.enterTemplate('Frame');
  assert.equal(owner.transaction, null);
  assert.equal(scope.ownerRevision, owner.revision);
  assert.equal(view.document, scope.document);
  assert.equal(view.resourceDocument, false);
  scope.setProperty('frame', 'Padding', 12);
  harness.arm(scope.document);
  const undoDepth = owner.undoStack.length;
  view.resources.leaveTemplate(true);
  assert.equal(owner.undoStack.length, undoDepth + 1);
  assert.equal(owner.value.templates.Frame.root.properties.Padding.Left, 12);
  assert.equal(view.document, owner);
  assert.equal(view.resourceDocument, true);
  assert.equal(scope.document.disposed, true);
  assert.equal(scope.document.transaction, null);
  assert.equal(trace.length, 12);
  owner.undo();
  assert.equal(owner.value.templates.Frame.root.properties.Padding.Left, 4);
  view.modelSubscription();
  view.resources.dispose();
  view.updates.dispose();
  owner.dispose();
});

test('A18 canceling a template restores its dictionary and leaves owner values and history unchanged', () => {
  const owner = createDesignerResourceDocument({templates: {Frame: {targetType: 'Button',
    root: {id: 'frame', type: 'Border', properties: {Padding: 4}, children: []}}}});
  const harness = lifecycleView(owner);
  const {view} = harness;
  view.resources = new DesignerResourceController(view);
  const before = owner.serialize();
  const scope = view.resources.enterTemplate('Frame');
  scope.setProperty('frame', 'Padding', 90);
  harness.expect(scope.document);
  view.resources.leaveTemplate(false);
  assert.equal(owner.serialize(), before);
  assert.equal(owner.undoStack.length, 0);
  assert.equal(scope.document.disposed, true);
  assert.equal(view.document, owner);
  view.modelSubscription();
  view.resources.dispose();
  view.updates.dispose();
  owner.dispose();
});

test('A18 direct dictionary action dispatch rejects scaffold mutations and launch before invoking app services', () => {
  const owner = createDesignerResourceDocument();
  let services = 0;
  const view = {document: owner, session: {document: owner, kind: 'resources'},
    save: () => ++services, launchDesignerApp: () => ++services, docking: {activate: () => ++services}};
  const actions = createDesignerActions(view);
  const before = owner.serialize();
  for (const action of ['delete', 'duplicate', 'paste', 'preview', 'attach', 'apply', 'run-app', 'generate']) {
    assert.throws(() => actions.get(action)(), {code: 'SFD1854'}, action);
  }
  assert.equal(services, 0);
  assert.equal(owner.serialize(), before);
  actions.get('save')();
  actions.get('properties')();
  assert.equal(services, 2);
  owner.dispose();
});

test('A18 Tools previews retain normal visual load, flush and resize while dictionary mode only builds its gallery', () => {
  const document = new DesignDocument(createDesign());
  const {view} = lifecycleView(document);
  const trace = [];
  view.resourceGallery = {render: () => trace.push('gallery')};
  view.buildPreviewScene = () => designScene(view.document.value);
  view.host = {elements: new Map(), load: scene => { trace.push('load'); assert(scene.nodes.some(node => node.id === 'action')); },
    flush: () => trace.push('flush')};
  view.resizeArtboard = () => trace.push('resize');
  view.updatePreview();
  assert.deepEqual(trace, ['gallery', 'load', 'flush', 'resize']);
  assert.equal(view.updates.preview.document, document);
  assert.equal(view.updates.preview.revision, document.revision);
  assert.deepEqual(view.updates.preview.environment, view.surface.preview.value);
  const resources = createDesignerResourceDocument();
  view.session.document = resources;
  trace.length = 0;
  view.updatePreview();
  assert.deepEqual(trace, ['gallery']);
  assert.equal(view.updates.preview.document, null);
  assert.equal(view.updates.preview.environment, null);
  assert.equal(view.updates.preview.decorations.size, 0);
  view.updates.dispose();
  document.dispose();
  resources.dispose();
});
