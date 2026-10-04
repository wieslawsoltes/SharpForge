import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, DesignerPropertyCommands, DesignerStyleCommands, DesignerTemplateScope, DesignerCollectionDraft,
  normalizeDesignerBrush, designScene, projectDesignerAuthoringScene, designerPropertySource, renameDesignerResource,
  generateDesignCode, generateDesignProject, generateDesignXaml, createDesignerResourceDocument, generateDesignerResourceClass,
  addDesignerVisualState, recordDesignerStateProperty, projectDesignerState, designerInstancePreviews, interpolateDesignerStateValue,
  designCodegenDiagnostics, csharpValue, DesignerStateTransition, setDesignerStateTransition
} from '@sharpforge/designer';
import {CONTROLS, XAML, MEDIA} from '@sharpforge/framework';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {DesignerStatePlayback} from '../apps/studio/designer-resource-playback.js';

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

test('A18 invalid collection draft edits and entry limits fail before changing the draft', () => {
  const document = fixture();
  const id = document.add('ComboBox', 'canvas');
  const draft = new DesignerCollectionDraft(document, id, 'Items');
  draft.add(17);
  assert.throws(() => draft.set(0, 'x'.repeat(100001)), /limit/);
  assert.equal(draft.items[0], 17);
  for (let index = 1; index < 1000; index++) draft.add('Item');
  assert.throws(() => draft.add('Overflow'), /1000/);
  assert.equal(draft.items.length, 1000);
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

test('A18 transition sampling interpolates double and color values and restores exact endpoints', () => {
  const document = fixture();
  document.setProperty('Width', 100, ['action']);
  document.setProperty('Background', '#000000', ['action']);
  addDesignerVisualState(document, {nodeId: 'action'}, 'CommonStates', 'PointerOver');
  for (const [property, value] of Object.entries({Width: 200, Background: '#ffffff', Visibility: 1})) {
    recordDesignerStateProperty(document, {nodeId: 'action'}, {group: 'CommonStates', state: 'PointerOver', nodeId: 'action', property, value});
  }
  setDesignerStateTransition(document, {nodeId: 'action'}, 'CommonStates', {to: 'PointerOver', duration: 200});
  const before = document.serialize();
  const base = designScene(document.value);
  const target = projectDesignerState(base, document.node('action').states, {CommonStates: 'PointerOver'});
  const session = new DesignerStateTransition(base, target, {duration: 200});
  const commands = session.commandsAt(100);
  assert.equal(commands.find(command => command.property === 'Width').value, 150);
  assert.equal(commands.find(command => command.property === 'Background').value.Color.R, 128);
  assert.equal(commands.find(command => command.property === 'Visibility').value, 0);
  assert.equal(session.commandsAt(200), commands);
  assert.equal(commands.find(command => command.property === 'Visibility').value, 1);
  assert.equal(commands.find(command => command.property === 'Background').value.Color.R, 255);
  assert.equal(base.nodes.find(node => node.id === 'action').properties.Width, 100);
  assert.equal(document.serialize(), before);
  assert.throws(() => session.commandsAt(-1), /between/);
  session.dispose();
  assert.throws(() => session.commandsAt(0), /closed/);
  assert.throws(() => new DesignerStateTransition(base, {...target, nodes: target.nodes.slice(1)}), /same preview tree/);
  assert.throws(() => new DesignerStateTransition(base, target, {duration: 60001}), /between/);
  assert.throws(() => recordDesignerStateProperty(document, {nodeId: 'action'}, {group: 'CommonStates', state: 'PointerOver',
    nodeId: 'action', property: 'Name', value: 'ChangedIdentity'}), /identity/);
});

test('A18 transition playback cancels stale frames and restores the base scene without document edits', () => {
  const document = fixture();
  const callbacks = new Map();
  let serial = 0;
  const clock = {requestAnimationFrame: callback => { callbacks.set(++serial, callback); return serial; },
    cancelAnimationFrame: id => callbacks.delete(id)};
  const applied = [];
  let shown;
  const view = {document, host: {document: {defaultView: clock}, elements: new Map(), load: scene => { shown = structuredClone(scene); },
    flush() {}, apply: commands => applied.push(structuredClone(commands))}, drawAdorners() {}, error: error => { throw error; }};
  const base = designScene(document.value);
  const target = structuredClone(base);
  target.nodes.find(node => node.id === 'action').properties.Width = 300;
  const playback = new DesignerStatePlayback(view);
  const advance = time => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    callback(time);
  };
  playback.play(base, base, target, {duration: 100});
  advance(0);
  advance(50);
  assert.equal(applied.at(-1).find(command => command.property === 'Width').value, 230);
  document.setProperty('Width', 240, ['action']);
  advance(100);
  assert.equal(callbacks.size, 0);
  assert.equal(applied.length, 2);
  assert.equal(playback.session, null);
  playback.show(base, target);
  playback.stop();
  assert.equal(shown.nodes.find(node => node.id === 'action').properties.Width, 160);
  assert.equal(document.node('action').properties.Width, 240);
  playback.play(base, base, target, {duration: 100});
  playback.dispose();
  assert.equal(callbacks.size, 0);
});

test('A18 template states project all instance prefixes in one isolated scene', () => {
  const document = fixture();
  document.setTemplate('Frame', {targetType: 'Button', root: {id: 'frame', type: 'Border', properties: {Background: '#000000'}, children: []}});
  document.setReference('template', 'Frame', ['action']);
  const duplicate = document.duplicate('action');
  addDesignerVisualState(document, {template: 'Frame'}, 'CommonStates', 'PointerOver');
  recordDesignerStateProperty(document, {template: 'Frame'}, {group: 'CommonStates', state: 'PointerOver',
    nodeId: 'frame', property: 'Background', value: '#ff0000'});
  const base = designScene(document.value);
  const scene = projectDesignerState(base, document.value.templates.Frame.states, {CommonStates: 'PointerOver'},
    {prefixes: ['action::', duplicate + '::']});
  assert.equal(scene.nodes.filter(node => node.id.endsWith('::frame') && node.properties.Background.Color.R === 255).length, 2);
  assert.equal(base.nodes.find(node => node.id === 'action::frame').properties.Background.Color.R, 0);
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

test('A18 registered gradients generate on both source targets and compile as a complete managed project', () => {
  const document = fixture();
  document.setProperty('Background', normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
    GradientStops: [{Offset: 0, Color: '#ff0000'}, {Offset: 1, Color: '#0000ff'}]}), ['action']);
  assert.deepEqual(designCodegenDiagnostics(document.value), []);
  assert.match(generateDesignCode(document.value), /new Microsoft\.UI\.Xaml\.Media\.LinearGradientBrush/);
  assert.match(generateDesignCode(document.value, {target: 'winui'}), /new Microsoft\.UI\.Xaml\.Media\.LinearGradientBrush/);
  const files = generateDesignProject(document.value).filter(file => file.path.endsWith('.cs'));
  const compiled = compileToIL(files.map(file => ({uri: file.path, text: file.text})));
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const machine of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
    const result = machine.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    const button = machine.platform.scene().nodes.find(node => node.properties.Name === 'ActionButton');
    assert.equal(button.properties.Background.valueType, MEDIA + 'LinearGradientBrush');
    assert.deepEqual(button.properties.Background.GradientStops.map(stop => stop.Offset), [0, 1]);
  }
  assert.equal(csharpValue({valueType: XAML + 'Thickness', Left: 8, Top: 8, Right: 8, Bottom: 8}, XAML + 'Thickness'),
    'new Microsoft.UI.Xaml.Thickness(8)');
});

test('A18 rich WinUI markup exports retain adaptive methods alongside resource references', () => {
  const document = fixture();
  new DesignerPropertyCommands(document).convertToResource('Width', 'ActionWidth', {ids: ['action']});
  document.change('Adaptive height', design => {
    design.responsive = {version: 1, states: [{id: 'Wide', minWidth: 600, maxWidth: null, overrides: {action: {Height: 80}}}]};
  });
  const source = generateDesignCode(document.value, {target: 'winui'});
  assert.match(source, /XamlReader.Load/);
  assert.match(source, /public static void ApplyAdaptive\(double width\)/);
  assert.match(source, /ApplyAdaptive\(960\.0\)/);
  assert.match(source, /action.Height = 80\.0/);
});
