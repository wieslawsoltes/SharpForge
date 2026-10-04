import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignDocument, createDesign} from '@sharpforge/designer';
import {ActiveDesignerTools} from '../apps/studio/designer-active-tools.js';
import {DesignerSourceSync} from '../apps/studio/designer-source-sync.js';
import {createAutomationApi} from '../apps/studio/automation-api.js';
import {contributeDesignerAutomation} from '../apps/studio/tools/designer-automation.js';

function automation() {
  const workbench = {state: {active: 'Program.cs'}, documents: {tools: null}};
  const facade = new ActiveDesignerTools(workbench);
  const registry = createAutomationApi();
  contributeDesignerAutomation(registry, {designerTools: facade});
  return {workbench, facade, registry, designer: registry.api.designer};
}

function linkedSource(uri) {
  const document = new DesignDocument(createDesign(uri));
  const sourceSync = new DesignerSourceSync({document});
  const operation = new AbortController();
  let protocolDisposals = 0;
  sourceSync.session = {analysis: {uri, method: {name: 'Create'}, warnings: []}};
  sourceSync.protocol = {designDirty: false, dispose() { protocolDisposals++; }};
  sourceSync.operation = operation;
  sourceSync.state = 'synced';
  return {document, sourceSync, operation, protocolDisposals: () => protocolDisposals,
    dispose() { sourceSync.dispose(); document.dispose(); }
  };
}

test('public designer disconnect is safe before any compatible document is active and after repeated cleanup', () => {
  const {designer, workbench, registry} = automation();
  const before = designer.get();

  assert.equal(designer.disconnect(), undefined);
  assert.equal(designer.disconnect(), undefined);

  assert.deepEqual(designer.get(), before);
  assert.deepEqual(before, {uri: null, document: null, sourceSync: {state: 'unlinked', uri: null}});
  assert.equal(workbench.state.active, 'Program.cs');
  assert.equal(workbench.documents.tools, null);
  registry.dispose();
});

test('public disconnect resolves the current source adapter and retains its model while cancelling its pending operation', () => {
  const {designer, workbench, registry} = automation();
  const first = linkedSource('A.cs');
  const second = linkedSource('B.cs');
  const firstModel = first.document.snapshot();
  const secondBefore = second.sourceSync.snapshot();
  workbench.documents.tools = first;

  assert.equal(designer.disconnect(), undefined);
  assert.equal(designer.disconnect(), undefined);

  assert.equal(first.sourceSync.snapshot().state, 'unlinked');
  assert.equal(first.sourceSync.snapshot().uri, null);
  assert.equal(first.operation.signal.aborted, true);
  assert.equal(first.protocolDisposals(), 1);
  assert.equal(first.document.disposed, false);
  assert.deepEqual(first.document.snapshot(), firstModel);
  assert.deepEqual(second.sourceSync.snapshot(), secondBefore);
  assert.equal(second.operation.signal.aborted, false);
  workbench.documents.tools = null;
  designer.disconnect();
  assert.deepEqual(second.sourceSync.snapshot(), secondBefore);

  workbench.documents.tools = second;
  designer.disconnect();

  assert.equal(second.sourceSync.state, 'unlinked');
  assert.equal(second.operation.signal.aborted, true);
  assert.equal(second.protocolDisposals(), 1);
  first.dispose();
  second.dispose();
  registry.dispose();
});

test('missing active designers still reject source operations and authoring instead of manufacturing an implicit document', () => {
  const {designer, workbench, registry} = automation();
  for (const action of [() => designer.readSource(), () => designer.writeSource(), () => designer.setAutoSync(true),
    () => designer.select(['window']), () => designer.set('Title', 'Changed'), () => designer.setView('design')]) {
    assert.throws(action, {message: 'Open a compatible C# or design document first'});
  }
  assert.equal(workbench.documents.tools, null);
  assert.equal(workbench.state.active, 'Program.cs');
  registry.dispose();
});

test('disconnect propagates an active adapter cleanup failure and preserves its method receiver', () => {
  const {designer, workbench, registry} = automation();
  const failure = new Error('Source cleanup failed');
  const sourceSync = {
    disconnect() {
      assert.equal(this, sourceSync);
      throw failure;
    }
  };
  workbench.documents.tools = {sourceSync};

  assert.throws(() => designer.disconnect(), error => error === failure);

  registry.dispose();
});
