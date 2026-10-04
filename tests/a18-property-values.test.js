import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignDocument, createDesign, createDesignerMetadata, designerMetadata, designerPropertySchema, designerChildSlot,
  normalizeDesignerColor, normalizeDesignerBrush, designerColorHex, colorToHsv, hsvToColor, csharpValue,
  PropertyEditorRegistry, createPropertyEditorRegistry, scrubDesignerNumber, DesignerPropertyCommands,
  designerPropertyRows, designerPropertySource, DesignerPropertyGridState, compatibleDesignerHandlers, setDesignerEventHandler,
  designerEventSourceAccess, designerEventHandlerRequest
} from '@sharpforge/designer';
import {CONTROLS, XAML, MEDIA, frameworkAssignable, frameworkManifest} from '@sharpforge/framework';
import {parseDesignerPropertyText, propertySelect} from '../apps/studio/designer-property-dom.js';

const fixture = () => new DesignDocument(createDesign('Authoring'));

test('A18 metadata covers every concrete visual in the framework API contract', () => {
  const expected = frameworkManifest.types.filter(type => type.kind === 'window' ||
    ['control', 'shape'].includes(type.kind) && frameworkAssignable(XAML + 'UIElement', type.name)).map(type => type.name).sort();
  assert.deepEqual(designerMetadata.map(type => type.type).sort(), expected);
  assert.deepEqual(createDesignerMetadata().map(type => type.type).sort(), expected);
  assert.equal(designerChildSlot('ContentDialog').property, 'Content');
  assert.equal(designerChildSlot('ComboBox').many, true);
  assert.equal(designerPropertySchema('Button').Opacity.constraints.maximum, 1);
  assert.equal(designerPropertySchema('Button').Row.owner, CONTROLS + 'Grid');
  assert.equal(designerPropertySchema('TextBox').FontFamily.category, 'Text & typography');
});

test('A18 immutable property schema caches preserve framework attached setter identities', () => {
  const schema = designerPropertySchema('Button');
  assert.equal(designerPropertySchema(CONTROLS + 'Button'), schema);
  assert(Object.isFrozen(schema));
  assert(Object.isFrozen(schema.Width));
  assert(Object.isFrozen(schema.Width.constraints));
  assert.throws(() => { schema.Width.category = 'Corrupted'; }, TypeError);
  assert.equal(schema.WrapColumnSpan.owner, CONTROLS + 'VariableSizedWrapGrid');
  assert.equal(schema.WrapColumnSpan.member, 'ColumnSpan');
  assert.equal(schema.WrapWrapColumnSpan, undefined);
});

test('A18 colors preserve alpha and round-trip RGBA/HSV at boundary hues', () => {
  const red = normalizeDesignerColor('#80ff0000');
  assert.equal(red.A, 128);
  assert.equal(designerColorHex(red), '#80ff0000');
  assert.deepEqual(hsvToColor(colorToHsv(red)), red);
  assert.equal(designerColorHex(hsvToColor({h: 360, s: 1, v: 1})), '#ffff0000');
  assert.throws(() => normalizeDesignerColor('#123'), /Colors/);
  assert.throws(() => normalizeDesignerColor({A: 256, R: 0, G: 0, B: 0}), /between/);
  assert.throws(() => hsvToColor({h: 0, s: 2, v: 1}), /between/);
});

test('A18 gradients normalize stable stops and generate exact WinUI constructors', () => {
  const brush = normalizeDesignerBrush({valueType: MEDIA + 'LinearGradientBrush',
    GradientStops: [{Color: '#ffffff', Offset: 1}, {Color: '#000000', Offset: 0}]});
  assert.deepEqual(brush.GradientStops.map(stop => stop.Offset), [0, 1]);
  const source = csharpValue(brush, MEDIA + 'Brush');
  assert.match(source, /new Microsoft\.UI\.Xaml\.Media\.LinearGradientBrush/);
  assert.match(source, /GradientStops = \{ new Microsoft\.UI\.Xaml\.Media\.GradientStop/);
  assert.match(source, /EndPoint = new Windows\.Foundation\.Point\(1, 1\)/);
  assert.throws(() => normalizeDesignerBrush({...brush, GradientStops: brush.GradientStops.slice(0, 1)}), /at least two/);
  assert.throws(() => normalizeDesignerBrush({...brush, GradientStops: Array(65).fill(brush.GradientStops[0])}), /64/);
});

test('A18 editor factories are isolated per registry and failures leave other rows usable', () => {
  const registry = new PropertyEditorRegistry();
  registry.register({id: 'broken', names: ['Width'], create: () => { throw new Error('Custom editor failed'); }});
  const unregister = registry.register({id: 'text', types: ['string'], create: context => ({value: context.value})});
  assert.equal(registry.create({name: 'Width', schema: {type: 'double'}}).diagnostic.code, 'SFD1832');
  assert.deepEqual(registry.create({name: 'Text', value: 'Still usable', schema: {type: 'string'}}).editor, {value: 'Still usable'});
  unregister();
  assert.equal(registry.create({name: 'Text', schema: {type: 'string'}}).diagnostic.code, 'SFD1831');
  assert.equal(new PropertyEditorRegistry().entries.length, 0);
  const defaults = createPropertyEditorRegistry({brush: () => 'brush', text: () => 'text', font: () => 'font'});
  assert.equal(defaults.create({name: 'FontFamily', schema: {type: 'string'}}).editor, 'font');
});

test('A18 scrub respects min/max integer and modifier constraints', () => {
  assert.equal(scrubDesignerNumber(5, 200, {minimum: 0, maximum: 10}), 10);
  assert.equal(scrubDesignerNumber(5, -200, {minimum: 0, maximum: 10}), 0);
  assert.equal(scrubDesignerNumber(5, 3, {integer: true}, {fine: true}), 5);
  assert.equal(scrubDesignerNumber(5, 3, {}, {coarse: true}), 35);
  assert.throws(() => scrubDesignerNumber(2, Infinity), /finite/);
});

test('A18 property reset reveals style values without changing style setters', () => {
  const document = fixture();
  document.setStyle('Size', {targetType: 'Button', setters: {Width: 91}});
  document.setReference('style', 'Size', ['action']);
  const commands = new DesignerPropertyCommands(document);
  commands.reset('Width', ['action']);
  const source = designerPropertySource(document.value, document.node('action'), 'Width');
  assert.equal(source.kind, 'style');
  assert.equal(source.value, 91);
  assert.equal(document.value.styles.Size.setters.Width, 91);
  document.undo();
  assert.equal(document.node('action').properties.Width, 160);
});

test('A18 multi-edit failures are atomic and protected properties cannot be changed', () => {
  const document = fixture();
  const commands = new DesignerPropertyCommands(document);
  const before = document.serialize();
  assert.throws(() => commands.set('Width', -2, ['action', 'title']), /negative/);
  assert.equal(document.serialize(), before);
  const protectedCommands = new DesignerPropertyCommands(document, {canEdit: id => id !== 'action'});
  assert.throws(() => protectedCommands.reset('Width', ['action']), /protected/);
  assert.equal(document.revision, 0);
});

test('A18 search filters Width, MinWidth, MaxWidth and mixed selection stays blank', () => {
  const document = fixture();
  const rows = designerPropertyRows(document.value, ['action'], {search: 'Wid', arrange: 'name'});
  assert.deepEqual(rows.map(row => row.name), ['MaxWidth', 'MinWidth', 'Width']);
  assert.equal(designerPropertyRows(document.value, ['action', 'title']).find(row => row.name === 'Width').mixed, true);
  const state = new DesignerPropertyGridState({arrange: 'source'});
  state.setCollapsed('Button', 'Placement', true);
  assert.equal(new DesignerPropertyGridState(state.snapshot()).isCollapsed('Button', 'Placement'), true);
});

test('A18 equal effective values retain their value while showing different sources', () => {
  const document = fixture();
  const duplicate = document.duplicate('action');
  document.setStyle('EqualWidth', {targetType: 'Button', setters: {Width: 160}});
  document.setReference('style', 'EqualWidth', [duplicate]);
  new DesignerPropertyCommands(document).reset('Width', [duplicate]);
  const row = designerPropertyRows(document.value, ['action', duplicate]).find(row => row.name === 'Width');
  assert.equal(row.value, 160);
  assert.equal(row.mixed, false);
  assert.equal(row.source.kind, 'mixed');
});

test('A18 resource conversion rejects a protected expression without substituting a style fallback', () => {
  const document = fixture();
  const commands = new DesignerPropertyCommands(document);
  commands.bind('Width', {path: 'Customer.Width'}, ['action']);
  const before = document.serialize();
  assert.throws(() => commands.convertToResource('Width', 'WidthResource', {ids: ['action']}), /concrete local value/);
  assert.equal(document.serialize(), before);
});

test('A18 property form text rejects malformed Booleans and selects its first available choice', () => {
  assert.equal(parseDesignerPropertyText('true', 'bool'), true);
  assert.equal(parseDesignerPropertyText('false', 'bool'), false);
  assert.throws(() => parseDesignerPropertyText('flase', 'bool'), error => error.code === 'SFD1844');
  const document = {createElement: () => ({children: [], setAttribute() {}, append(item) { this.children.push(item); }})};
  const select = propertySelect(document, [{value: 'first', label: 'First'}, {value: 'second', label: 'Second'}], undefined, 'Choice');
  assert.equal(select.value, 'first');
});

test('A18 event picker excludes incompatible parameter and return signatures', () => {
  const handlers = [{name: 'Program.Click', parameters: ['object', XAML + 'RoutedEventArgs'], returnType: 'void'},
    {name: 'Program.Bad', parameters: ['string', 'string'], returnType: 'void'},
    {name: 'Program.Result', parameters: ['object', XAML + 'RoutedEventArgs'], returnType: 'int'}];
  assert.deepEqual(compatibleDesignerHandlers('Button', 'Click', handlers).map(handler => handler.name), ['Program.Click']);
  const document = fixture();
  setDesignerEventHandler(document, 'action', 'Click', 'Program.Click', handlers);
  assert.equal(document.node('action').events.Click, 'Program.Click');
  const revision = document.revision;
  assert.throws(() => setDesignerEventHandler(document, 'action', 'Click', 'Program.Bad', handlers), /compatible/);
  assert.equal(document.revision, revision);
});

test('A18 protected event subscriptions expose source navigation but reject staging and new handlers', () => {
  const document = fixture();
  const multiple = {capability: 'navigate', reason: 'multiple', subscriptions: [
    {handler: 'OnClick', location: {uri: 'Page.cs', start: 40, end: 48}},
    {handler: 'OnOther', span: {start: 120, end: 127}}
  ]};
  const access = designerEventSourceAccess(multiple, {uri: 'Page.cs'});
  assert.equal(access.editable, false);
  assert.equal(access.canNavigate, true);
  assert.equal(access.subscriptions[1].location.start, 120);
  assert.match(access.reason, /Multiple subscriptions/);
  const before = document.serialize();
  assert.throws(() => setDesignerEventHandler(document, 'action', 'Click', '', {sourceBinding: multiple}), /protected/);
  assert.throws(() => designerEventHandlerRequest(document.node('action'), 'Click', 'NewHandler', {sourceBinding: multiple}), /protected/);
  assert.equal(document.serialize(), before);
  const lambda = designerEventSourceAccess({capability: 'navigate', reason: 'lambda', subscriptions: [
    {handler: null, protected: true, span: {start: 70, end: 90}}
  ]}, {uri: 'Page.cs'});
  assert.equal(lambda.canNavigate, true);
  assert.equal(lambda.editable, false);
  assert.equal(lambda.subscriptions[0].location.start, 70);
});
