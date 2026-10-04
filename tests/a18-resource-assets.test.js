import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignerResourceDocument, DesignerAssetPreviewStore, addDesignerVisualState,
  recordDesignerStateProperty, designerInstancePreviews} from '@sharpforge/designer';
import {designerAssetReferenceScene} from '../apps/studio/designer-property-asset-references.js';
import {DesignerAssetPreviewController} from '../apps/studio/designer-property-preview.js';

function fixture() {
  const model = createDesignerResourceDocument({resources: {
    Logo: {kind: 'theme', type: 'string', variants: {default: 'Images/day.png', dark: 'Images/night.png',
      highContrast: 'Images/high.png'}}, Unused: {type: 'string', value: 'Labels/this-is-not-an-image'}
  }, templates: {Picture: {targetType: 'Button', root: {id: 'image', type: 'Image', properties: {}, children: [],
    resourceReferences: {Source: {kind: 'theme', key: 'Logo'}}}}}});
  addDesignerVisualState(model, {template: 'Picture'}, 'CommonStates', 'Pressed');
  recordDesignerStateProperty(model, {template: 'Picture'}, {group: 'CommonStates', state: 'Pressed',
    nodeId: 'image', property: 'Source', value: 'Images/pressed.png'});
  return model;
}

test('A18 dictionary image inventory discovers unused templates, theme variants and state images without its scaffold scene', async () => {
  const model = fixture();
  const before = model.serialize();
  const paths = ['Images/day.png', 'Images/high.png', 'Images/night.png', 'Images/pressed.png'];
  assert.deepEqual(designerAssetReferenceScene(model.value).nodes.map(node => node.properties.Source).sort(), paths);
  const reads = [];
  const revoked = [];
  let objects = 0;
  const store = new DesignerAssetPreviewStore({readAsset: async path => { reads.push(path); return new Uint8Array([1]); },
    makeBlob: bytes => bytes, createObjectURL: () => 'blob:asset-' + ++objects, revokeObjectURL: uri => revoked.push(uri)});
  let renders = 0;
  let strips = 0;
  const view = {document: model, assetPreviews: store, records: () => paths.map(path => ({path})),
    buildPreviewScene: () => { throw new Error('Dictionary scaffold must not be projected'); },
    updatePreview: () => renders++, resources: {refreshPreviews: () => strips++}, error: error => { throw error; }};
  const controller = new DesignerAssetPreviewController(view);
  const result = await controller.refresh();
  assert.equal(result.loaded, 4);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(reads.sort(), paths);
  assert.equal(controller.version, 1);
  assert.equal(renders, 1);
  assert.equal(strips, 1);
  assert.equal((await controller.refresh()).loaded, 0);
  assert.equal(reads.length, 4);
  const preview = designerInstancePreviews(model.value, {resourceKey: 'Picture', kind: 'template', themes: ['dark'], states: ['Pressed'],
    resolveAsset: uri => store.resolve(uri)})[0];
  assert.equal(preview.scene.nodes.find(node => node.id === 'preview::image').properties.Source, store.resolve('Images/pressed.png'));
  assert.equal(model.serialize(), before);
  controller.dispose();
  store.dispose();
  assert.equal(revoked.length, 4);
  model.dispose();
});

test('A18 replaced dictionary owners discard stale asset completion and retain ungranted-image diagnostics', async () => {
  const model = fixture();
  let complete;
  const waiting = new Promise(resolve => { complete = resolve; });
  const store = new DesignerAssetPreviewStore({readAsset: () => waiting,
    makeBlob: bytes => bytes, createObjectURL: () => 'blob:late', revokeObjectURL() {}});
  let renders = 0;
  const diagnostics = [];
  const view = {document: model, assetPreviews: store, records: () => [{path: 'Images/day.png'}],
    updatePreview: () => renders++, error: error => diagnostics.push(error)};
  const controller = new DesignerAssetPreviewController(view);
  const pending = controller.refresh();
  const replacement = createDesignerResourceDocument();
  view.document = replacement;
  complete(new Uint8Array([1]));
  assert.equal((await pending).stale, true);
  assert.equal(controller.version, 0);
  assert.equal(renders, 0);
  assert.deepEqual(diagnostics, []);
  view.document = model;
  const result = await controller.refresh();
  assert.equal(result.loaded, 0);
  assert.equal(result.diagnostics.length, 3);
  assert(result.diagnostics.every(diagnostic => diagnostic.code === 'SFD1863'));
  assert.equal(diagnostics.length, 3);
  controller.dispose();
  store.dispose();
  replacement.dispose();
  model.dispose();
});
