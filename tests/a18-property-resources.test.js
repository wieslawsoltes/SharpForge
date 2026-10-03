import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, DesignerPropertyCommands, DesignerStyleCommands, DesignerTemplateScope, DesignerCollectionDraft,
  normalizeDesignerBrush, designScene, projectDesignerAuthoringScene, designerPropertySource, renameDesignerResource,
  generateDesignCode, generateDesignProject, generateDesignXaml, createDesignerResourceDocument, generateDesignerResourceClass,
  addDesignerVisualState, recordDesignerStateProperty, projectDesignerState, designerInstancePreviews, interpolateDesignerStateValue,
  designCodegenDiagnostics, csharpValue
} from '@sharpforge/designer';
import {CONTROLS, XAML, MEDIA} from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const fixture = () => new DesignDocument(createDesign('Resources'));

test('A18 scalar/object Items edits emit ordered Add calls and execute on source and CIL VMs', () => {
  const document = fixture();
  const id = document.add('ComboBox', 'canvas', {Name: 'Choices'});
  const draft = new DesignerCollectionDraft(document, id, 'Items');
  draft.add('First');
  draft.add({type: 'ComboBoxItem', properties: {Content: 'Second'}});
  draft.add('Third');
  draft.move(2, 1);
  draft.apply();
  assert.equal(document.node(id).collections.Items[1], 'Third');
  const source = generateDesignCode(document.value);
  assert(source.indexOf('.Items.Add("First")') < source.indexOf('.Items.Add("Third")'));
  const files = generateDesignProject(document.value).filter(file => file.path.endsWith('.cs')).map(file => ({uri: file.path, text: file.text}));
  const compiled = compileToIL(files);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.platform.scene().nodes.find(node => node.properties.Name === 'Choices').collections.Items.length, 3);
  }
});

test('A18 collection cancellation and stale apply leave the live collection untouched', () => {
  const document = fixture();
  const id = document.add('ComboBox', 'canvas');
  const draft = new DesignerCollectionDraft(document, id, 'Items');
  draft.add('Canceled');
  draft.cancel();
  assert.throws(() => draft.apply(), /closed/);
  assert.equal(document.node(id).collections, undefined);
  const stale = new DesignerCollectionDraft(document, id, 'Items');
  stale.add('Stale');
  document.setProperty('Width', 90, [id]);
  assert.throws(() => stale.apply(), /changed/);
  assert.equal(document.node(id).collections, undefined);
});

test('A18 style extraction moves chosen local values and copy isolates the original', () => {
  const document = fixture();
  document.select('action');
  const commands = new DesignerStyleCommands(document);
  commands.createFromSelection('Extracted', {properties: ['Width']});
  assert.equal(document.node().properties.Width, undefined);
  assert.equal(document.node().style, 'Extracted');
  assert.equal(document.value.styles.Extracted.setters.Width, 160);
  commands.editCopy('Extracted', 'Copy');
  commands.setSetter('Copy', 'Width', 220);
  assert.equal(document.value.styles.Extracted.setters.Width, 160);
  assert.equal(document.value.styles.Copy.setters.Width, 220);
  assert.throws(() => commands.apply('Copy', ['title']), /Incompatible/);
});

test('A18 template scope commits every instance with unique part identities', () => {
  const document = fixture();
  document.setTemplate('Frame', {targetType: 'Button', root: {id: 'frame', type: 'Border', properties: {Padding: 4}, children: []}});
  document.setReference('template', 'Frame', ['action']);
  const duplicate = document.duplicate('action');
  const scope = new DesignerTemplateScope(document, 'Frame');
  scope.setProperty('frame', 'Padding', 12);
  assert.equal(document.value.templates.Frame.root.properties.Padding.Left, 4);
  scope.commit();
  const scene = designScene(document.value);
  assert.equal(scene.nodes.find(node => node.id === 'action::frame').properties.Padding.Left, 12);
  assert.equal(scene.nodes.find(node => node.id === duplicate + '::frame').properties.Padding.Left, 12);
  assert.notEqual(scene.nodes.find(node => node.id === 'action').templateRoot, scene.nodes.find(node => node.id === duplicate).templateRoot);
  assert.throws(() => scope.commit(), /closed/);
});

test('A18 static/theme resource renames update all protected references atomically', () => {
  const document = fixture();
  const commands = new DesignerPropertyCommands(document);
  commands.set('Background', '#112233', ['action']);
  commands.convertToResource('Background', 'ActionBrush', {ids: ['action'], theme: true});
  renameDesignerResource(document, 'ActionBrush', 'RenamedBrush');
  assert.equal(document.node('action').resourceReferences.Background.key, 'RenamedBrush');
  assert.equal(document.value.resources.ActionBrush, undefined);
  assert.equal(designerPropertySource(document.value, document.node('action'), 'Background').kind, 'resource');
  const scene = projectDesignerAuthoringScene(document.value, designScene(document.value), {theme: 'dark'});
  assert.equal(scene.nodes.find(node => node.id === 'action').properties.Background.Color.R, 17);
  const markup = generateDesignXaml(document.value);
  assert.match(markup, /ThemeResource RenamedBrush/);
  assert.match(markup, /ResourceDictionary.ThemeDictionaries/);
  assert.throws(() => renameDesignerResource(document, 'RenamedBrush', 'Accent'), /already exists/);
});

test('A18 created bindings round-trip as protected data without preview evaluation', () => {
  const document = fixture();
  new DesignerPropertyCommands(document).bind('Content', {path: 'Customer.Name', mode: 'TwoWay'}, ['action']);
  const loaded = new DesignDocument(JSON.parse(document.serialize()));
  assert.deepEqual(loaded.node('action').bindings.Content, {path: 'Customer.Name', mode: 'TwoWay'});
  assert.equal(designerPropertySource(loaded.value, loaded.node('action'), 'Content').kind, 'binding');
  assert.equal(loaded.node('action').properties.Content, undefined);
  assert.match(generateDesignXaml(loaded.value), /Binding Path="Customer.Name" Mode="TwoWay"/);
  assert.throws(() => new DesignerPropertyCommands(loaded).bind('Content', {path: 'Run()'}, ['action']), /paths/);
});

test('A18 recorded PointerOver states preview without document mutation and preserve transition values', () => {
  const document = fixture();
  addDesignerVisualState(document, {nodeId: 'action'}, 'CommonStates', 'PointerOver');
  recordDesignerStateProperty(document, {nodeId: 'action'}, {group: 'CommonStates', state: 'PointerOver',
    nodeId: 'action', property: 'Background', value: '#ff0000'});
  const before = document.serialize();
  const scene = projectDesignerState(designScene(document.value), document.node('action').states, {CommonStates: 'PointerOver'});
  assert.equal(scene.nodes.find(node => node.id === 'action').properties.Background.Color.R, 255);
  assert.equal(document.serialize(), before);
  assert.match(generateDesignXaml(document.value), /VisualState x:Name="PointerOver"/);
  const black = normalizeDesignerBrush('#000000');
  const white = normalizeDesignerBrush('#ffffff');
  assert.equal(interpolateDesignerStateValue(black, white, 0.5).Color.R, 128);
});

test('A18 preview strip provides five independent states for both themes', () => {
  const document = fixture();
  const before = document.serialize();
  const previews = designerInstancePreviews(document.value, {resourceKey: 'Accent'});
  assert.equal(previews.length, 10);
  assert.equal(previews.filter(preview => preview.theme === 'light').length, 5);
  assert.equal(new Set(previews.map(preview => preview.scene)).size, 10);
  assert.equal(document.serialize(), before);
});

test('A18 resource-class documents rename keys and export declarative WinUI dictionaries', () => {
  const document = createDesignerResourceDocument({resources: {Blue: {type: MEDIA + 'Brush', value: '#0000ff'}}});
  renameDesignerResource(document, 'Blue', 'AccentBlue');
  const code = generateDesignerResourceClass(document.value);
  assert.match(code, /ResourceDictionary/);
  assert.match(code, /AccentBlue/);
  assert.doesNotMatch(code, /x:Key=\\"Blue\\"/);
});

test('A18 unsupported browser profile features report diagnostics; WinUI export retains them', () => {
  const document = fixture();
  document.setProperty('Background', normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
    GradientStops: [{Offset: 0, Color: '#ff0000'}, {Offset: 1, Color: '#0000ff'}]}), ['action']);
  assert(designCodegenDiagnostics(document.value).some(diagnostic => diagnostic.code === 'SFD1872'));
  assert.throws(() => generateDesignCode(document.value), /LinearGradientBrush/);
  assert.match(generateDesignCode(document.value, {target: 'winui'}), /new Microsoft\.UI\.Xaml\.Media\.LinearGradientBrush/);
  assert.equal(csharpValue({valueType: XAML + 'Thickness', Left: 8, Top: 8, Right: 8, Bottom: 8}, XAML + 'Thickness'),
    'new Microsoft.UI.Xaml.Thickness(8)');
});
