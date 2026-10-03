import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, createDesignerRoot, DesignerRootRegistry, setDesignerSampleData, createDesignerSampleItems,
  designScene, projectDesignerAuthoringScene, generateDesignCode, generateDesignProject, stripDesignerOnlyData,
  designerAssets, designerAssetUri, normalizeDesignerAssetPath, DesignerAssetPreviewStore,
  DesignerOptionsService, defaultDesignerOptions, designerControlName, readExtendedDesignerSourceValue,
  normalizeDesignerBrush, DesignerPropertyCommands, importDesignerAuthoringResources
} from '@sharpforge/designer';
import {CONTROLS, MEDIA} from '@sharpforge/framework';

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
