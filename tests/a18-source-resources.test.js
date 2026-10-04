import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesign, DesignDocument, generateDesignCode, readDesignSource, planDesignSourceUpdate,
} from '@sharpforge/designer';

const handler = '\nclass Program { public static void OnAction(object sender, Microsoft.UI.Xaml.RoutedEventArgs args) { } }\n';
const frame = () => ({
  targetType: 'Button',
  root: {id: 'frame', type: 'Border', properties: {Padding: 8}, bindings: {}, children: [
    {id: 'label', type: 'TextBlock', properties: {Text: 'Template text'}, bindings: {Foreground: 'Foreground'}, children: []},
  ]},
});

function initial() {
  const document = new DesignDocument(createDesign('Resources'));
  document.setStyle('Base', {targetType: 'Button', setters: {Width: 100}});
  document.setStyle('Accent', {targetType: 'Button', basedOn: 'Base', setters: {FontSize: 16}});
  document.setTemplate('Frame', frame());
  document.setReference('template', 'Frame', ['action']);
  return document.value;
}

const source = document => generateDesignCode(document ?? initial()) + handler;
const read = text => readDesignSource(text, {uri: 'View.cs'});
const edited = base => new DesignDocument(base.document);
const rejection = action => assert.throws(action,
  error => ['SFSYNC_OWNERSHIP', 'SFSYNC_REFERENCE', 'SFSYNC_DYNAMIC', 'SFSYNC_SYMBOL'].includes(error.code));

test('unchanged styles, template factories, references and source bytes produce no resource edits', () => {
  const text = source().replace('    static Microsoft.UI.Xaml.Controls.ControlTemplate',
    '    // factory note\n    static Microsoft.UI.Xaml.Controls.ControlTemplate');
  const base = read(text);
  const plan = planDesignSourceUpdate(base, base.document);
  assert.equal(plan.text, text);
  assert.equal(plan.edits.length, 0);
  assert.equal(plan.changes.length, 0);
});

test('changing a style retains source variable aliases, unchanged resources, comments and user handlers', () => {
  const text = source().replaceAll('style_Base', 'foundation').replaceAll('style_Accent', 'accent')
    .replace('accent = new', 'accent = /* preserve accent comment */ new');
  const base = read(text);
  const next = edited(base);
  const oldTemplate = base.templateMethods.get('Frame');
  const oldFactoryText = text.slice(oldTemplate.start, oldTemplate.end);
  const baseStatements = base.resources.get('foundation').statements.map(statement => text.slice(statement.start, statement.end));
  next.setStyle('accent', {targetType: 'Button', basedOn: 'foundation', setters: {FontSize: 22, Height: 52}});
  const plan = planDesignSourceUpdate(base, next.value);
  assert.equal(plan.document.styles.accent.setters.FontSize, 22);
  assert.equal(plan.document.styles.accent.basedOn, 'foundation');
  assert.match(plan.text, /accent\.Setters\.Add/);
  assert.doesNotMatch(plan.text, /style_accent|style_foundation/);
  for (const statement of baseStatements) assert(plan.text.includes(statement));
  assert.equal(plan.text.split('/* preserve accent comment */').length - 1, 1);
  assert(plan.text.includes(oldFactoryText));
  assert(plan.text.endsWith(handler));
  assert.equal(plan.analysis.resources.get('accent').kind, 'style');
});

test('new BasedOn dependencies precede a rewritten existing style and every control declaration', () => {
  const base = read(source());
  const next = edited(base);
  next.setStyle('NewBase', {targetType: 'Button', setters: {Height: 41}});
  next.setStyle('Accent', {targetType: 'Button', basedOn: 'NewBase', setters: {FontSize: 19}});
  const plan = planDesignSourceUpdate(base, next.value, base.text, {requireCompilation: true});
  const added = plan.text.indexOf('Style style_NewBase =');
  const dependent = plan.text.indexOf('Style style_Accent =');
  const control = plan.text.indexOf('v_window = new');
  assert(added >= 0 && added < dependent && dependent < control);
  assert.equal(plan.document.styles.Accent.basedOn, 'NewBase');
  assert.equal(plan.document.styles.NewBase.setters.Height, 41);
});

for (const type of ['Microsoft.UI.Xaml.Style', 'var']) {
  test(`rewritten ${type} resource declarations preserve their type and compile with dependent styles and templates`, () => {
    const text = source().replace('Microsoft.UI.Xaml.Style style_Base =', `${type} style_Base =`);
    const base = read(text);
    const next = edited(base);
    next.setStyle('Base', {targetType: 'Button', setters: {Width: 130}});
    const plan = planDesignSourceUpdate(base, next.value, base.text, {requireCompilation: true});
    assert.equal(plan.compilationSucceeded, true);
    assert(plan.text.includes(`${type} style_Base = new Microsoft.UI.Xaml.Style(`));
    assert.equal(plan.document.styles.Base.setters.Width, 130);
    assert.equal(plan.document.styles.Accent.basedOn, 'Base');
    assert.equal(plan.document.templates.Frame.root.children[0].bindings.Foreground, 'Foreground');
  });
}

test('using-alias declaration spelling survives resource edits without hiding existing compiler-profile diagnostics', () => {
  const text = 'using StyleAlias = Microsoft.UI.Xaml.Style;\n'
    + source().replace('Microsoft.UI.Xaml.Style style_Base =', 'StyleAlias style_Base =');
  const base = read(text);
  const next = edited(base);
  next.setStyle('Base', {targetType: 'Button', setters: {Width: 130}});
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.includes('StyleAlias style_Base = new Microsoft.UI.Xaml.Style('));
  assert.equal(plan.document.styles.Base.setters.Width, 130);
  assert.equal(plan.compilationSucceeded, base.compilationSucceeded);
  const diagnostics = items => items.map(({code, message, severity}) => ({code, message, severity}));
  assert.deepEqual(diagnostics(plan.diagnostics), diagnostics(base.compilerDiagnostics));
});

test('added style dependencies are emitted in topological order even when dictionary order differs', () => {
  const base = read(source());
  const next = edited(base);
  next.change('Add dependency graph', document => {
    document.styles.Child = {targetType: 'Button', basedOn: 'Parent', setters: {Width: 111}};
    document.styles.Parent = {targetType: 'Button', basedOn: 'Base', setters: {Height: 42}};
    document.nodes.find(node => node.id === 'action').style = 'Child';
  });
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.indexOf('Style style_Parent =') < plan.text.indexOf('Style style_Child ='));
  assert(plan.text.indexOf('Style style_Child =') < plan.text.indexOf('v_window = new'));
  assert.equal(plan.document.nodes.find(node => node.id === 'action').style, 'Child');
});

test('removing an unused style deletes only its owned construction and setter statements', () => {
  const base = read(source());
  const next = edited(base);
  next.setStyle('Accent', {targetType: 'Button', setters: {FontSize: 16}});
  next.setStyle('Base', null);
  const plan = planDesignSourceUpdate(base, next.value);
  assert.equal(plan.document.styles.Base, undefined);
  assert.equal(plan.document.styles.Accent.basedOn, undefined);
  assert.doesNotMatch(plan.text, /style_Base/);
  assert(plan.text.endsWith(handler));
});

test('clearing a style reference removes all superseded assignments so old local values do not reappear', () => {
  const text = source().replace('v_action.Style = style_Accent;',
    'v_action.Style = style_Base; /* old value */\n        v_action.Style = style_Accent;');
  const base = read(text);
  const next = edited(base);
  next.setReference('style', null, ['action']);
  const plan = planDesignSourceUpdate(base, next.value);
  assert.equal(plan.document.nodes.find(node => node.id === 'action').style, undefined);
  assert.doesNotMatch(plan.text, /v_action\.Style\s*=/);
  assert(plan.text.includes('/* old value */'));
});

test('style reference changes touch the mapped expression and preserve initializer neighbors', () => {
  const text = source().replace('v_action = new Microsoft.UI.Xaml.Controls.Button();',
    'v_action = new Microsoft.UI.Xaml.Controls.Button() { Style = style_Accent, Opacity = 0.9 };')
    .replace('        v_action.Style = style_Accent;\n', '');
  const base = read(text);
  const next = edited(base);
  next.setReference('style', 'Base', ['action']);
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.includes('{ Style = style_Base, Opacity = 0.9 }'));
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.document.nodes.find(node => node.id === 'action').style, 'Base');
});

test('changing a proven template updates its body while retaining factory name, signature and comments', () => {
  const text = source().replaceAll('template_Frame', 'decorator').replaceAll('Template_Frame', 'BuildDecorator')
    .replace('static Microsoft.UI.Xaml.Controls.ControlTemplate BuildDecorator()',
      'private static Microsoft.UI.Xaml.Controls.ControlTemplate BuildDecorator() /* factory signature */')
    .replace('template.VisualTree =', '/* retain template explanation */\n        template.VisualTree =');
  const base = read(text);
  const next = edited(base);
  next.change('Edit template', document => { document.templates.decorator.root.properties.Width = 245; });
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.includes('private static Microsoft.UI.Xaml.Controls.ControlTemplate BuildDecorator() /* factory signature */'));
  assert.equal(plan.text.split('/* retain template explanation */').length - 1, 1);
  assert(plan.text.includes('decorator = BuildDecorator();'));
  assert.equal(plan.document.templates.decorator.root.properties.Width, 245);
  assert(plan.text.endsWith(handler));
  const old = base.templateMethods.get('decorator');
  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0].start, old.body.start);
  assert.equal(plan.edits[0].end, old.body.end);
});

test('new templates get a factory and resource declaration before controls and a mapped node reference', () => {
  const base = read(source());
  const next = edited(base);
  const template = frame();
  template.root.properties.Width = 210;
  next.setTemplate('Second', template);
  next.setReference('template', 'Second', ['action']);
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.indexOf('template_Second = Template_Second();') < plan.text.indexOf('v_window = new'));
  assert(plan.text.includes('static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Second()'));
  assert.equal(plan.document.nodes.find(node => node.id === 'action').template, 'Second');
  assert.equal(plan.document.templates.Second.root.properties.Width, 210);
  assert(plan.text.endsWith(handler));
});

test('removed templates delete their owned variable and unused factory and preserve factory comments', () => {
  const text = source().replace('template.VisualTree =', '/* removed factory note */\n        template.VisualTree =');
  const base = read(text);
  const next = edited(base);
  next.setReference('template', null, ['action']);
  next.setTemplate('Frame', null);
  const plan = planDesignSourceUpdate(base, next.value);
  assert.equal(plan.document.templates.Frame, undefined);
  assert.equal(plan.document.nodes.find(node => node.id === 'action').template, undefined);
  assert.doesNotMatch(plan.text, /Template_Frame|template_Frame/);
  assert(plan.text.includes('/* removed factory note */'));
  assert(plan.text.endsWith(handler));
});

test('template body changes in sibling partial files preserve the primary source exactly', () => {
  const generated = generateDesignCode(initial());
  const start = generated.indexOf('    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Frame');
  const end = generated.lastIndexOf('\n}');
  const primary = generated.slice(0, start).replace('public class DesignedView', 'public partial class DesignedView') + '}\n' + handler;
  const sibling = 'public partial class DesignedView\n{\n' + generated.slice(start, end) + '\n}\n';
  const sources = [{uri: 'View.cs', text: primary, version: 7}, {uri: 'Frame.cs', text: sibling, version: 12}];
  const base = readDesignSource(primary, {uri: 'View.cs', sources});
  const next = edited(base);
  next.change('Edit sibling template', document => { document.templates.Frame.root.properties.Height = 90; });
  const plan = planDesignSourceUpdate(base, next.value, sources);
  assert.equal(plan.text, primary);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].uri, 'Frame.cs');
  assert.equal(plan.changes[0].expectedVersion, 12);
  assert.equal(plan.sources.find(file => file.uri === 'View.cs').text, primary);
  assert.equal(plan.document.templates.Frame.root.properties.Height, 90);
});

test('shared template factory cannot silently give one alias a different visual definition', () => {
  const document = new DesignDocument(initial());
  document.setTemplate('Alias', frame());
  const text = source(document.value).replace('template_Alias = Template_Alias();', 'template_Alias = Template_Frame();');
  const base = read(text);
  const next = edited(base);
  next.change('Diverge one alias', value => { value.templates.Frame.root.properties.Width = 123; });
  rejection(() => planDesignSourceUpdate(base, next.value));
  assert.equal(base.text, text);
});

test('new controls receive resource references and new Grids receive definitions after their declarations', () => {
  const base = read(source());
  const next = edited(base);
  const button = next.add('Button', 'canvas');
  next.setReference('style', 'Accent', [button]);
  next.setReference('template', 'Frame', [button]);
  const grid = next.add('Grid', 'canvas');
  next.tracks(grid, ['Auto', '2*'], ['120']);
  const plan = planDesignSourceUpdate(base, next.value);
  const buttonName = plan.analysis.bindings[button].name;
  const gridName = plan.analysis.bindings[grid].name;
  assert(plan.text.indexOf(`${buttonName} = new`) < plan.text.indexOf(`${buttonName}.Style = style_Accent;`));
  assert(plan.text.indexOf(`${gridName} = new`) < plan.text.indexOf(`${gridName}.RowDefinitions.Add`));
  assert.equal(plan.document.nodes.find(node => node.id === button).template, 'Frame');
  assert.equal(plan.document.nodes.find(node => node.id === grid).rows.length, 2);
  assert.equal(plan.document.nodes.find(node => node.id === grid).columns[0].Value, 120);
});

function gridSource() {
  const document = new DesignDocument(initial());
  document.change('Use Grid', value => { value.nodes.find(node => node.id === 'canvas').type = 'Microsoft.UI.Xaml.Controls.Grid'; });
  document.tracks('canvas', ['Auto', '2*'], ['120', '*']);
  return source(document.value);
}

test('a Grid track value edit preserves additional initializer properties and unrelated definitions', () => {
  const text = gridSource().replace('RowDefinition() { Height =', 'RowDefinition() { MinHeight = 12, Height =');
  const base = read(text);
  const next = edited(base);
  next.tracks('canvas', ['64', '2*'], ['120', '*']);
  const untouched = base.bindings.canvas.tracks.rows[1].statement;
  const original = text.slice(untouched.start, untouched.end);
  const plan = planDesignSourceUpdate(base, next.value);
  assert.equal(plan.edits.length, 1);
  assert(plan.text.includes('MinHeight = 12, Height ='));
  assert(plan.text.includes(original));
  assert.equal(plan.document.nodes.find(node => node.id === 'canvas').rows[0].Value, 64);
});

test('adding and removing Grid tracks preserves existing definitions and removed statement comments', () => {
  const text = gridSource().replace('v_canvas.ColumnDefinitions.Add(', 'v_canvas.ColumnDefinitions.Add(/* column comment */ ');
  const base = read(text);
  const next = edited(base);
  next.tracks('canvas', ['Auto', '2*', '50'], []);
  const plan = planDesignSourceUpdate(base, next.value);
  const grid = plan.document.nodes.find(node => node.id === 'canvas');
  assert.equal(grid.rows.length, 3);
  assert.equal(grid.rows[2].Value, 50);
  assert.deepEqual(grid.columns ?? [], []);
  assert(plan.text.includes('/* column comment */'));
});

test('resource and track edits preserve CRLF and UTF-16 comments without formatting untouched handlers', () => {
  const text = gridSource().replace('// Generated by', '// 😀 Zażółć\n// Generated by').replaceAll('\n', '\r\n');
  const base = read(text);
  const next = edited(base);
  next.setStyle('Accent', {targetType: 'Button', basedOn: 'Base', setters: {FontSize: 23}});
  next.tracks('canvas', ['88', '2*'], ['120', '*']);
  const plan = planDesignSourceUpdate(base, next.value);
  assert(plan.text.includes('// 😀 Zażółć\r\n'));
  assert.equal(plan.text.replaceAll('\r\n', '').includes('\n'), false);
  assert(plan.text.endsWith(handler.replaceAll('\n', '\r\n')));
});

for (const property of ['implicit', 'theme']) {
  test(`unsupported changed style metadata ${property} is an explicit ownership diagnostic`, () => {
    const base = read(source());
    const next = edited(base);
    next.change('Unsupported metadata', document => {
      document.styles.Accent[property] = property === 'implicit' ? true : 'Dark';
    });
    rejection(() => planDesignSourceUpdate(base, next.value));
    assert.equal(base.document.styles.Accent[property], undefined);
  });
}

test('adding a resource never shadows a handwritten local with the generated resource name', () => {
  const text = source().replace('v_window = new', 'int style_Taken = 3;\n        v_window = new');
  const base = read(text);
  const next = edited(base);
  next.setStyle('Taken', {targetType: 'Button', setters: {Width: 120}});
  rejection(() => planDesignSourceUpdate(base, next.value));
  assert.equal(base.text, text);
});

test('custom template methods are neither replaced nor hidden by a newly generated factory', () => {
  const text = source().replace('    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Frame()',
    '    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Custom() { return null; }\n'
    + '    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Frame()');
  const base = read(text);
  const next = edited(base);
  next.setTemplate('Custom', frame());
  rejection(() => planDesignSourceUpdate(base, next.value));
  assert.equal(base.text, text);
});

test('template factories referenced by user handlers are retained by refusing unsafe deletion', () => {
  const text = source().replace('    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Frame()',
    '    public static Microsoft.UI.Xaml.Controls.ControlTemplate ForUser() { return Template_Frame(); }\n'
    + '    static Microsoft.UI.Xaml.Controls.ControlTemplate Template_Frame()');
  const base = read(text);
  const next = edited(base);
  next.setReference('template', null, ['action']);
  next.setTemplate('Frame', null);
  rejection(() => planDesignSourceUpdate(base, next.value));
  assert.equal(base.text, text);
});

test('resource edits honor the planner cancellation gate before producing source changes', () => {
  const base = read(source());
  const next = edited(base);
  next.setStyle('Accent', {targetType: 'Button', basedOn: 'Base', setters: {FontSize: 25}});
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => planDesignSourceUpdate(base, next.value, base.text, {signal: controller.signal}),
    error => error.code === 'SFSYNC_CANCELLED');
  assert.equal(base.document.styles.Accent.setters.FontSize, 16);
});
