import test from 'node:test';
import assert from 'node:assert/strict';
import { createItemPlan } from '@sharpforge/templates';
import { readDesignXaml, planDesignXamlUpdate, XamlDesignSession, DesignDocument, designScene,
  generateDesignCode, designSourceFormat } from '@sharpforge/designer';
import { compileToIL } from '@sharpforge/compiler';
import { VirtualMachine, CilVirtualMachine } from '@sharpforge/runtime';

const header = 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
const example = '<Page ' + header + ' x:Class="Example.View">\n' +
  '  <!-- Keep author note: λ 😀 -->\n  <StackPanel x:Name="panel">\n' +
  '    <TextBlock x:Name="caption" Text=\'Hello &amp; world\' FontSize="18" />\n' +
  '    <Button x:Name="action" Width = \'180\' Content="Run" Click="OnClick" />\n' +
  '  </StackPanel>\n</Page>\n';

for (const kind of ['page', 'window', 'user-control', 'content-dialog']) {
  test('Generated XAML ' + kind + ' loads, preserves its source, and projects to source/CIL runtime scenes', async () => {
    const plan = createItemPlan('winui-xaml-' + kind, { name: 'Qualified.xaml', namespace: 'Qualified' });
    const source = plan.records.find(record => record.path.endsWith('.xaml'));
    const behind = plan.records.find(record => record.path.endsWith('.xaml.cs')).text;
    const analysis = readDesignXaml(source.text, { uri: source.path });
    assert.deepEqual(analysis.warnings, []);
    assert.equal(planDesignXamlUpdate(analysis, analysis.document).text, source.text);
    assert.equal(designScene(analysis.document).windows.length, 1);
    const generated = generateDesignCode(analysis.document, { className: 'Preview' });
    const compiled = compileToIL(generated + '\nclass Host { static void Main() { Preview.Create(); } }');
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    for (const vm of [new VirtualMachine(compiled.image), new CilVirtualMachine(compiled.assembly)]) {
      assert.equal((await vm.runAsync()).state, 'terminated');
      assert.equal(vm.platform.scene().windows.length, 1);
      assert(vm.platform.scene().nodes.some(node => node.type.endsWith('.TextBlock') && node.properties.Text === 'Qualified'));
    }
    assert.equal(plan.records.find(record => record.path.endsWith('.xaml.cs')).text, behind);
  });
}

test('XAML scalar spans preserve BOM, CRLF, quotes, comments and unrelated event attributes', () => {
  const source = '\ufeff' + example.replaceAll('\n', '\r\n');
  const analysis = readDesignXaml(source);
  const design = new DesignDocument(analysis.document);
  design.setProperty('Width', 248, ['action']);
  const plan = planDesignXamlUpdate(analysis, design.value);
  assert.equal(plan.text, source.replace("'180'", "'248'"));
  assert.equal(plan.edits.length, 1);
  design.setProperty('Text', 'Zażółć <&> "😀"', ['caption']);
  design.setProperty('HorizontalAlignment', 1, ['action']);
  design.setProperty('IsEnabled', false, ['action']);
  const changed = planDesignXamlUpdate(analysis, design.value);
  const button = changed.document.nodes.find(node => node.id === 'action');
  assert.equal(button.properties.HorizontalAlignment, 1);
  assert.equal(button.properties.IsEnabled, false);
  assert.equal(button.events.Click, 'OnClick');
  assert.equal(changed.document.nodes.find(node => node.id === 'caption').properties.Text, 'Zażółć <&> "😀"');
  assert(changed.text.includes('<!-- Keep author note: λ 😀 -->\r\n'));
});

test('XAML Grid tracks, property containers, literal text and attached properties round-trip', () => {
  const source = '<UserControl ' + header + '><Grid x:Name="grid"><Grid.RowDefinitions>' +
    '<RowDefinition Height="Auto"/><RowDefinition Height="2*"/></Grid.RowDefinitions>' +
    '<Grid.Children><TextBlock x:Name="label" Grid.Row="1">Hello &amp; Unicode 😀</TextBlock></Grid.Children></Grid></UserControl>';
  const analysis = readDesignXaml(source);
  const design = new DesignDocument(analysis.document);
  assert.equal(design.node('grid').rows[1].Value, 2);
  assert.equal(design.node('label').properties.Row, 1);
  design.setProperty('Text', 'Updated <text>', ['label']);
  assert.equal(planDesignXamlUpdate(analysis, design.value).document.nodes.find(node => node.id === 'label').properties.Text, 'Updated <text>');
  design.tracks('grid', ['80', '*'], ['2*', 'Auto']);
  const plan = planDesignXamlUpdate(analysis, design.value);
  assert.equal(plan.document.nodes.find(node => node.id === 'grid').columns[0].Value, 2);
  assert(plan.structural);
});

test('XAML structural edits retain metadata/comments and identities; Name changes remain synchronized', () => {
  const session = new XamlDesignSession(example);
  const design = new DesignDocument(session.document);
  const id = design.add('TextBlock', 'panel', { Text: 'Added' });
  design.move(id, 'panel', 0);
  design.setProperty('Name', 'RenamedButton', ['action']);
  const plan = session.plan(design.value);
  assert(plan.text.includes('x:Class="Example.View"'));
  assert(plan.text.includes('<!-- Keep author note: λ 😀 -->'));
  assert(plan.text.includes('Click="OnClick"'));
  assert.equal(plan.document.nodes.find(node => node.id === 'action').properties.Name, 'RenamedButton');
  session.commit(plan);
  assert.deepEqual(session.document, plan.document);
  const next = new DesignDocument(session.document);
  next.remove([id]);
  session.commit(session.plan(next.value));
  assert.equal(session.document.nodes.length, 4);
});

test('XAML Window identity metadata survives structural edits and inherited-object names stay ordinary identities', () => {
  const source = '<Window ' + header + ' x:Name="host"><StackPanel x:Name="__proto__">' +
    '<Button x:Name="constructor" Content="Original" /></StackPanel></Window>';
  const analysis = readDesignXaml(source);
  assert(Object.hasOwn(analysis.bindings, '__proto__'));
  const design = new DesignDocument(analysis.document);
  design.setProperty('Content', 'Updated', ['constructor']);
  design.add('TextBlock', '__proto__', { Text: 'Added' });
  const plan = planDesignXamlUpdate(analysis, design.value);
  assert(plan.text.includes('x:Name="host"'));
  assert.equal(plan.document.root, 'host');
  assert.equal(plan.document.nodes.find(node => node.id === 'constructor').properties.Content, 'Updated');
  assert(Object.hasOwn(plan.analysis.bindings, '__proto__'));
});

test('XAML malformed inputs, unsupported APIs, namespaces, bindings and budgets produce stable diagnostics', () => {
  const cases = [
    ['<!DOCTYPE Page SYSTEM "file:///untrusted"><Page ' + header + '/>', 'SFXAML001'],
    ['<Page ' + header + '><UnknownControl/></Page>', 'SFXAML002'],
    ['<Page ' + header + ' xmlns:e="untrusted"><e:Button/></Page>', 'SFXAML002'],
    ['<Page ' + header + ' Width="NaN"/>', 'SFXAML004'],
    ['<Page ' + header + ' DoesNotExist="1"/>', 'SFXAML004'],
    ['<Page ' + header + '><TextBlock Text="{Binding Name}"/></Page>', 'SFXAML005'],
    ['<Page ' + header + '><StackPanel><TextBlock x:Name="same"/><TextBlock x:Name="same"/></StackPanel></Page>', 'SFXAML006']
  ];
  for (const [source, code] of cases) assert.throws(() => readDesignXaml(source), error => error.code === code && error.diagnostics.length === 1);
  assert.throws(() => readDesignXaml(example, { maxNodes: 2 }), /limit/);
  assert.throws(() => readDesignXaml(example, { maxLength: 10 }), /limit/);
  assert.throws(() => readDesignXaml(example, { maxDepth: 2 }), /limit/);
  assert.throws(() => readDesignXaml(example, { maxNodes: NaN }), /limit/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => readDesignXaml(example, { signal: controller.signal }), { name: 'AbortError' });
});

test('XAML optimistic sessions reject stale edits and malformed reads without replacing their baseline', () => {
  const session = new XamlDesignSession(example, { uri: 'View.xaml' });
  const original = session.analysis;
  const design = new DesignDocument(session.document);
  design.setProperty('Width', 260, ['action']);
  assert.throws(() => session.plan(design.value, example + ' '), error => error.code === 'SFXAML007');
  assert.throws(() => session.read(example.replace('</Page>', '</Window>')));
  assert.equal(session.analysis, original);
  const plan = session.plan(design.value);
  session.read(example);
  assert.throws(() => session.commit(plan), error => error.code === 'SFXAML007');
  assert.equal(designSourceFormat('View.xaml').Session, XamlDesignSession);
  assert.equal(designSourceFormat('View.cs').id, 'csharp');
  assert.throws(() => designSourceFormat('unknown.xml'), /provider/);
});
