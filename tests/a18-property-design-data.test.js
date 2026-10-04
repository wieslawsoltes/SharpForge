import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, createDesignerRoot, DesignerRootRegistry, setDesignerSampleData, createDesignerSampleItems,
  designScene, projectDesignerAuthoringScene, generateDesignCode, generateDesignProject, stripDesignerOnlyData,
  designerAssets, designerAssetUri, normalizeDesignerAssetPath, DesignerAssetPreviewStore,
  DesignerOptionsService, defaultDesignerOptions, designerControlName, readExtendedDesignerSourceValue,
  normalizeDesignerBrush, DesignerPropertyCommands, importDesignerAuthoringResources, importDesignerTemplateResources,
  addDesignerVisualState, recordDesignerStateProperty, pruneDesignerAuthoring, copyDesignerAuthoringNodeMetadata, referencedDesignerAssets
} from '@sharpforge/designer';
import {CONTROLS, MEDIA} from '@sharpforge/framework';
import {DesignerAssetPreviewController} from '../apps/studio/designer-property-preview.js';

const fixture = () => new DesignDocument(createDesign('Sample data'));

test('A18 ListView renders five sample rows and emits none into generated runtime source', () => {
  const document = fixture();
  const id = document.add('ListView', 'canvas');
  setDesignerSampleData(document, id, {items: createDesignerSampleItems(5, {prefix: 'OnlyInDesigner'})});
  const scene = projectDesignerAuthoringScene(document.value, designScene(document.value));
  assert.equal(scene.nodes.find(node => node.id === id).collections.Items.length, 5);
  assert.deepEqual(scene.nodes.find(node => node.id === id).collections.Items, ['OnlyInDesigner 1', 'OnlyInDesigner 2',
    'OnlyInDesigner 3', 'OnlyInDesigner 4', 'OnlyInDesigner 5']);
  assert.doesNotMatch(generateDesignCode(document.value), /OnlyInDesigner|designTime/);
  for (const file of generateDesignProject(document.value).filter(file => file.path.endsWith('.cs'))) {
    assert.doesNotMatch(file.text, /OnlyInDesigner|designTime/);
  }
  assert.equal(stripDesignerOnlyData(document.value).designTime, undefined);
});

test('A18 sample collections reject invalid targets and excessive counts atomically', () => {
  const document = fixture();
  const before = document.serialize();
  assert.throws(() => setDesignerSampleData(document, 'action', {items: ['Invalid']}), /collection/);
  assert.equal(document.serialize(), before);
  assert.throws(() => createDesignerSampleItems(1001), /between/);
  assert.deepEqual(createDesignerSampleItems(0), []);
});

test('A18 Page previews a project UserControl with independently prefixed identities and source navigation', () => {
  const card = createDesignerRoot('UserControl', {name: 'Card'});
  card.add('TextBlock', 'layout', {Name: 'Caption', Text: 'Nested control'});
  const page = createDesignerRoot('Page', {name: 'PageView'});
  const id = page.add('UserControl', 'layout');
  page.change('Reference project control', design => {
    design.projectTypes = [{type: 'Example.Card', baseType: CONTROLS + 'UserControl', uri: 'Card.cs'}];
    design.nodes.find(node => node.id === id).projectType = 'Example.Card';
  });
  const registry = new DesignerRootRegistry();
  const dispose = registry.register(page.value.projectTypes[0], card, {analysisVersion: 4});
  const result = registry.project(page.value);
  assert.equal(result.diagnostics.length, 0);
  assert(result.scene.nodes.some(node => node.id.startsWith(id + '::component:') && node.properties.Text === 'Nested control'));
  assert.equal(registry.definition(page.node(id)).uri, 'Card.cs');
  assert.throws(() => registry.register(page.value.projectTypes[0], card, {analysisVersion: 3}), /Stale/);
  dispose();
  assert.equal(registry.project(page.value).diagnostics[0].code, 'SFD1862');
});

test('A18 project root registration requires compilation success and rejects unknown root types', () => {
  assert.throws(() => createDesignerRoot('Button'), /root/);
  const registry = new DesignerRootRegistry();
  const document = createDesignerRoot();
  assert.throws(() => registry.register({type: 'Example.Card', baseType: 'UserControl'}, document, {successful: false}), /successful/);
  assert.equal(createDesignerRoot('ContentDialog').node().type, CONTROLS + 'ContentDialog');
});

test('A18 recursive project-control compositions fail before exposing a misleading preview', () => {
  const document = createDesignerRoot();
  const descriptor = {type: 'Example.Recursive', baseType: CONTROLS + 'UserControl'};
  const child = document.add('UserControl', 'layout');
  document.change('Recursive project type', design => {
    design.projectTypes = [descriptor];
    design.nodes.find(node => node.id === child).projectType = descriptor.type;
  });
  const registry = new DesignerRootRegistry();
  registry.register(descriptor, document, {analysisVersion: 1});
  assert.throws(() => registry.project(document.value), /Recursive/);
});

test('A18 asset inventory generates stable escaped relative paths and rejects traversal and schemes', () => {
  const records = [{path: 'Images/My Icon.png', bytes: new Uint8Array([1, 2])}, {path: 'Views/Page.cs', text: ''}];
  const assets = designerAssets(records);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].uri, 'Images/My%20Icon.png');
  assert.equal(designerAssetUri('Images/My Icon.png', {basePath: 'Views/Page.cs'}), '../Images/My%20Icon.png');
  for (const path of ['../outside.png', '/root.png', 'https://example.com/a.png', 'a/../b.png', 'a.png?token=private']) {
    assert.throws(() => normalizeDesignerAssetPath(path), /path|project/);
  }
});

test('A18 asset previews revoke every authorized object URL on disposal', async () => {
  const revoked = [];
  const asset = designerAssets([{path: 'icon.png'}])[0];
  let reads = 0;
  const store = new DesignerAssetPreviewStore({readAsset: async () => { reads++; return new Uint8Array([1, 2]); },
    makeBlob: (bytes, mimeType) => ({bytes, mimeType}), createObjectURL: () => 'blob:asset-1', revokeObjectURL: url => revoked.push(url)});
  assert.equal(await store.preview(asset), 'blob:asset-1');
  assert.equal(await store.preview(asset), 'blob:asset-1');
  assert.equal(reads, 1);
  assert.equal(store.resolve('icon.png'), 'blob:asset-1');
  store.dispose();
  assert.deepEqual(revoked, ['blob:asset-1']);
  await assert.rejects(store.preview(asset), /closed/);
});

test('A18 concurrent asset previews share reads and respect memory and concurrency budgets', async () => {
  const assets = designerAssets([{path: 'first.png'}, {path: 'second.png'}]);
  const reads = [];
  const completions = new Map();
  let objects = 0;
  const store = new DesignerAssetPreviewStore({maxConcurrent: 1, maxBytes: 3,
    readAsset: path => { reads.push(path); return new Promise(resolve => completions.set(path, resolve)); },
    makeBlob: bytes => bytes, createObjectURL: () => 'blob:' + ++objects, revokeObjectURL() {}});
  const first = store.preview(assets[0]);
  const duplicate = store.preview(assets[0]);
  const second = store.preview(assets[1]);
  const rejected = assert.rejects(second, /memory budget/);
  await Promise.resolve();
  assert.deepEqual(reads, ['first.png']);
  completions.get('first.png')(new Uint8Array([1, 2]));
  assert.deepEqual(await Promise.all([first, duplicate]), ['blob:1', 'blob:1']);
  assert.deepEqual(reads, ['first.png', 'second.png']);
  completions.get('second.png')(new Uint8Array([3, 4]));
  await rejected;
  assert.equal(objects, 1);
  assert.equal(store.byteLength, 2);
  store.dispose();
});

test('A18 closing an asset owner cancels queued previews and rejects malformed image payloads', async () => {
  const [first, second] = designerAssets([{path: 'first.png'}, {path: 'second.png'}]);
  let finish;
  let objects = 0;
  let reads = 0;
  const store = new DesignerAssetPreviewStore({maxConcurrent: 1, maxEntries: 2,
    readAsset: () => { reads++; return new Promise(resolve => { finish = resolve; }); },
    makeBlob: bytes => bytes, createObjectURL: () => 'blob:' + ++objects, revokeObjectURL() {}});
  const pending = assert.rejects(store.preview(first), /closed/);
  const queued = assert.rejects(store.preview(second), /closed/);
  await assert.rejects(store.preview({...second, path: 'third.png'}), /entry budget/);
  store.dispose();
  finish(new Uint8Array([1]));
  await Promise.all([pending, queued]);
  assert.equal(reads, 1);
  assert.equal(objects, 0);
  const invalid = new DesignerAssetPreviewStore({readAsset: async () => 'not bytes', makeBlob: value => value,
    createObjectURL() {}, revokeObjectURL() {}});
  await assert.rejects(invalid.preview(first), /requires bytes/);
  await assert.rejects(invalid.preview({...first, mimeType: 'text/html'}), /recognized image type/);
  assert.throws(() => new DesignerAssetPreviewStore({maxConcurrent: Infinity}), /between/);
  invalid.dispose();
});

test('A18 opened designs preload authorized referenced assets before refreshing their surface', async () => {
  const document = fixture();
  const id = document.add('Image', 'canvas', {Source: 'Images/icon.png'});
  new DesignerPropertyCommands(document).convertToResource('Source', 'IconUri', {ids: [id]});
  let reads = 0;
  let rendered = 0;
  const store = new DesignerAssetPreviewStore({readAsset: async () => { reads++; return new Uint8Array([1]); },
    makeBlob: bytes => bytes, createObjectURL: () => 'blob:loaded-image', revokeObjectURL() {}});
  const view = {document, assetPreviews: store, records: () => [{path: 'Images/icon.png'}], error: error => { throw error; },
    buildPreviewScene: () => projectDesignerAuthoringScene(document.value, designScene(document.value), {resolveAsset: uri => store.resolve(uri)}),
    updatePreview: () => { rendered++; }};
  const controller = new DesignerAssetPreviewController(view);
  assert.equal((await controller.refresh()).loaded, 1);
  assert.equal(view.buildPreviewScene().nodes.find(node => node.id === id).properties.Source, 'blob:loaded-image');
  assert.equal((await controller.refresh()).loaded, 0);
  assert.equal(reads, 1);
  assert.equal(rendered, 1);
  assert.doesNotMatch(document.serialize(), /blob:/);
  const unknown = referencedDesignerAssets({nodes: [{id, properties: {Source: 'https://ungranted.example/image.png'}}]}, view.records());
  assert.equal(unknown.assets.length, 0);
  assert.equal(unknown.diagnostics[0].code, 'SFD1863');
  controller.dispose();
  assert.equal((await controller.refresh()).stale, true);
  store.dispose();
});

test('A18 designer options persist, apply to new documents and preserve state after failed writes', () => {
  const values = new Map();
  const settings = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
  const service = new DesignerOptionsService(settings);
  assert.equal(service.load().zoom, defaultDesignerOptions.zoom);
  service.update({defaultView: 'split', splitOrientation: 'horizontal', snap: 4, zoom: 1.25, autoSync: false, naming: 'camelCase'});
  const loaded = new DesignerOptionsService(settings);
  assert.equal(loaded.load().defaultView, 'split');
  const view = {};
  assert.equal(loaded.applyToNewDocument(view).splitOrientation, 'horizontal');
  assert.equal(view.zoom, 1.25);
  assert.equal(view.autoSync, false);
  const before = structuredClone(loaded.value);
  loaded.settings = {setItem: () => { throw new Error('Quota exceeded'); }};
  assert.throws(() => loaded.update({snap: 16}), /Quota/);
  assert.deepEqual(loaded.value, before);
  assert.throws(() => service.update({zoom: 20}), /between/);
  assert.equal(designerControlName('Button', ['button1', 'button2'], {naming: 'camelCase'}), 'button3');
  assert.equal(designerControlName('Button', [], {naming: 'none'}), '');
});

test('A18 closed gradient syntax is decoded without executing source', () => {
  const brush = normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush', GradientStops: [
    {Offset: 0, Color: '#000000'}, {Offset: 1, Color: '#ffffff'}]});
  const node = {kind: 'New', type: MEDIA + 'LinearGradientBrush', args: [], initializers: [
    {name: 'GradientStops', expression: {kind: 'DesignCollection', items: brush.GradientStops}}
  ]};
  assert.deepEqual(readExtendedDesignerSourceValue(node, value => value).value, brush);
  assert.equal(readExtendedDesignerSourceValue({kind: 'Call'}, () => { throw new Error('Must not run'); }).handled, false);
});

test('A18 copied resource references avoid collisions and retain source resources', () => {
  const source = fixture();
  const destination = fixture();
  const commands = new DesignerPropertyCommands(source);
  commands.convertToResource('Width', 'Size', {ids: ['action']});
  destination.change('Conflicting resource', design => { design.resources = {Size: {kind: 'value', type: 'double', value: 99}}; });
  const node = structuredClone(source.node('action'));
  const design = destination.snapshot();
  importDesignerAuthoringResources(source.value, design, node);
  assert.equal(node.resourceReferences.Width.key, 'Size_1');
  assert.equal(design.resources.Size.value, 99);
  assert.equal(design.resources.Size_1.value, 160);
  assert.equal(source.node('action').resourceReferences.Width.key, 'Size');
});

test('A18 template clipboard imports remap resource keys before destination template reuse', () => {
  const source = fixture();
  const destination = fixture();
  new DesignerPropertyCommands(source).convertToResource('Background', 'SurfaceBrush', {ids: ['canvas']});
  destination.change('Other brush', design => {
    design.resources = {SurfaceBrush: {kind: 'value', type: MEDIA + 'Brush', value: '#ffffff'}};
  });
  const template = {targetType: CONTROLS + 'Button', root: {id: 'part', type: CONTROLS + 'Border', properties: {}, children: [],
    resourceReferences: {Background: {kind: 'static', key: 'SurfaceBrush'}}}};
  const target = destination.snapshot();
  const copied = importDesignerTemplateResources(source.value, target, structuredClone(template));
  assert.equal(copied.root.resourceReferences.Background.key, 'SurfaceBrush_1');
  assert.equal(template.root.resourceReferences.Background.key, 'SurfaceBrush');
  assert.equal(target.resources.SurfaceBrush.value.Color.R, 255);
  assert.equal(target.resources.SurfaceBrush_1.value.Color.R, 32);
});

test('A18 copying and deleting controls updates scoped states samples bindings and adaptive references', () => {
  const source = fixture();
  addDesignerVisualState(source, {nodeId: 'action'}, 'CommonStates', 'Pressed');
  recordDesignerStateProperty(source, {nodeId: 'action'}, {group: 'CommonStates', state: 'Pressed',
    nodeId: 'action', property: 'Width', value: 190});
  setDesignerSampleData(source, 'action', {properties: {Content: 'Designer sample'}});
  new DesignerPropertyCommands(source).bind('Content', {path: 'Content', elementName: 'ActionButton'}, ['action']);
  source.setTemplate('PartScope', {targetType: 'Button', root: {id: 'action', type: 'Border', properties: {}, children: []}});
  addDesignerVisualState(source, {template: 'PartScope'}, 'PartStates', 'Pressed');
  recordDesignerStateProperty(source, {template: 'PartScope'}, {group: 'PartStates', state: 'Pressed',
    nodeId: 'action', property: 'Opacity', value: 0.5});
  source.change('Adaptive source', design => {
    design.responsive = {version: 1, states: [{id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Width: 240}}}]};
  });
  const destination = source.snapshot();
  const copy = structuredClone(source.node('action'));
  copy.id = 'action_copy';
  copy.properties.Name = 'ActionButton_copy';
  destination.nodes.push(copy);
  destination.nodes.find(node => node.id === 'canvas').children.push(copy.id);
  copyDesignerAuthoringNodeMetadata(source.value, destination, new Map([['action', copy.id]]));
  assert.equal(copy.states[0].states[0].setters[0].target, copy.id);
  assert.equal(destination.nodes.find(node => node.id === 'action').states[0].states[0].setters[0].target, 'action');
  assert.equal(copy.bindings.Content.elementName, 'ActionButton_copy');
  assert.equal(destination.designTime.nodes[copy.id].properties.Content, 'Designer sample');
  assert.equal(destination.responsive.states[0].overrides[copy.id].Width, 240);
  destination.nodes = destination.nodes.filter(node => node.id !== 'action');
  destination.nodes.find(node => node.id === 'canvas').children = destination.nodes.find(node => node.id === 'canvas').children
    .filter(id => id !== 'action');
  pruneDesignerAuthoring(destination, ['action']);
  assert.equal(destination.designTime.nodes.action, undefined);
  assert.equal(destination.responsive.states[0].overrides.action, undefined);
  assert.equal(destination.templates.PartScope.states[0].states[0].setters[0].target, 'action');
  assert.equal(new DesignDocument(destination).node(copy.id).states[0].states[0].setters[0].target, copy.id);
});
