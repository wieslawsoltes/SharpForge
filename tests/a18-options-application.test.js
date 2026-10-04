import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesign, defaultGuideSettings, DesignerOptionsService, initializeDesignerDocumentOptions} from '@sharpforge/designer';
import {designerSourceDocument} from '../apps/studio/designer-source-projection.js';
import {applyDesignerOptions} from '../apps/studio/designer-options-application.js';
import {studioHarness, sourceState} from './fixtures/a18-studio-harness.js';

function service() {
  const values = new Map();
  return new DesignerOptionsService({getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)});
}

test('A18 new-document defaults initialize the actual guide metadata without mutating input or source projection', () => {
  const options = service();
  options.update({snap: 24, autoSync: false});
  const original = createDesign();
  const before = structuredClone(original);
  const created = initializeDesignerDocumentOptions(original, options.value);
  assert.equal(created.designer.guides.gridSize, 24);
  assert.equal(created.designer.guides.snapGrid, true);
  assert.deepEqual(original, before);
  assert.deepEqual(designerSourceDocument(created), designerSourceDocument(original));
  assert.throws(() => initializeDesignerDocumentOptions(original, {snap: 0}), {code: 'SFD1804'});
});

test('A18 serialized guide choices and recovery metadata win over creation defaults', () => {
  const original = createDesign();
  original.designer = {guides: {...defaultGuideSettings, gridSize: 5, gridVisible: false,
    guides: [{id: 'kept', axis: 'x', position: 120}]}, other: {preserved: true}};
  const restored = initializeDesignerDocumentOptions(original, {snap: 32});
  assert.deepEqual(restored.designer, original.designer);
  assert.notEqual(restored.designer, original.designer);
  assert.notEqual(restored.designer.guides.guides, original.designer.guides.guides);
});

test('A18 applying options uses SourceSync.setAuto and guide model while leaving linked C# and preview identity clean', async context => {
  const harness = await studioHarness(context);
  await harness.connect();
  const before = sourceState(harness);
  const options = service();
  options.update({snap: 16, autoSync: false, zoom: 1.25, naming: 'camelCase', splitOrientation: 'horizontal'});
  harness.view.designerOptions = options;
  const calls = [];
  harness.view.cancelSurfaceEdits = () => calls.push('cancel');
  harness.view.resizeArtboard = () => calls.push('resize');
  harness.view.documentHost.setSplitOrientation = value => calls.push(value);
  harness.sync.setAuto(true);
  applyDesignerOptions(harness.view);
  assert.deepEqual(calls, ['cancel', 'horizontal', 'resize']);
  assert.equal(harness.sync.auto, false);
  assert.equal(harness.document.value.designer.guides.gridSize, 16);
  assert.equal(harness.view.zoom, 1.25);
  assert.equal(harness.view.naming, 'camelCase');
  assert.equal(harness.sync.dirty(), false);
  assert.equal(harness.sync.protocol.sourceDirty, false);
  assert.deepEqual(sourceState(harness), before);
  assert.equal(harness.document.node('action').properties.Width, 160);
});
