import test from 'node:test';
import assert from 'node:assert/strict';
import {XamlObjectWriter, XamlWriter, XamlParseException, ResourceDictionary} from '@sharpforge/winui-properties';
import {xamlFixture} from './helpers/a15-resource-fixtures.js';

const ns = 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';

test('XAML: property/content elements, names, converters and local resources build a live object graph', () => {
  const fixture = xamlFixture();
  const loader = new XamlObjectWriter(fixture.schema);
  const result = loader.load(`<Grid ${ns}><StackPanel><Button x:Name="Action" Content="Go" Width="12" Margin="1,2" /></StackPanel></Grid>`);
  const button = result.root.Children[0].Children[0];
  assert.equal(result.namescope.findName('Action'), button);
  assert.equal(button.Content, 'Go');
  assert.equal(button.Width, 12);
  assert.deepEqual(button.Margin, {left: 1, top: 2, right: 1, bottom: 2});
  const local = loader.load(`<Button ${ns} Content="{StaticResource Label}"><Button.Resources><x:String x:Key="Label">Local</x:String></Button.Resources></Button>`);
  assert.equal(local.root.Content, 'Local');
  result.lifetime.dispose();
  local.lifetime.dispose();
});

test('XAML: canonical serialization preserves edited null values and structurally round-trips resource dictionaries', () => {
  const fixture = xamlFixture();
  const loader = new XamlObjectWriter(fixture.schema);
  const writer = new XamlWriter(fixture.schema, {typeOf: value => value.valueType});
  const result = loader.load(`<Grid ${ns}><Button Content="Go" Margin="1,2,3,4" /><TextBlock Text="{ }" /></Grid>`.replace('Text="{ }"', 'Text="{}{literal}"'));
  result.root.Children[0].Content = null;
  const saved = writer.save(result.root);
  const restored = loader.load(saved);
  assert.equal(restored.root.Children[0].Content, null);
  assert.equal(restored.root.Children[1].Text, '{literal}');
  assert.deepEqual(restored.root.Children[0].Margin, result.root.Children[0].Margin);
  const resources = loader.load(`<ResourceDictionary ${ns}><x:String x:Key="text">{literal}</x:String><Style TargetType="Button"><Setter Property="Width" Value="15" /></Style></ResourceDictionary>`);
  assert.ok(resources.root instanceof ResourceDictionary);
  const roundTrip = loader.load(writer.save(resources.root));
  assert.equal(roundTrip.root.get('text'), '{literal}');
  assert.equal(roundTrip.root.get('Microsoft.UI.Xaml.Controls.Button').setters[0].value, 15);
});

test('XAML: deferred styles/templates preserve BasedOn, lexical references, and namespace aliases through serialization', () => {
  const fixture = xamlFixture();
  const loader = new XamlObjectWriter(fixture.schema);
  const writer = new XamlWriter(fixture.schema);
  const source = `<ResourceDictionary ${ns} xmlns:q="http://schemas.microsoft.com/winfx/2006/xaml">
    <Style x:Key="Base" TargetType="Button"><Setter Property="Width" Value="10" /></Style>
    <Style x:Key="Derived" TargetType="Button" BasedOn="{StaticResource Base}" />
    <DataTemplate x:Key="Template"><Button x:Name="Part" Content="{q:Null}" /></DataTemplate>
  </ResourceDictionary>`;
  const result = loader.load(source);
  const before = fixture.created();
  const saved = writer.save(result.root);
  assert.equal(fixture.created(), before);
  const restored = loader.load(saved);
  const style = restored.root.get('Derived');
  assert.equal(style.basedOn.setters[0].value, 10);
  const template = restored.root.get('Template');
  const first = template.instantiate();
  const second = template.instantiate();
  assert.notEqual(first.root, second.root);
  assert.equal(first.namescope.findName('Part'), first.root);
  assert.equal(first.root.Content, null);
  first.dispose();
  second.dispose();
});

test('XAML: unknown types/directives/properties fail preflight before any constructor executes', () => {
  for (const source of [`<Grid ${ns}><Process /></Grid>`, `<Grid ${ns} x:Class="Escape" />`,
    `<Grid ${ns} Unknown="1" />`, `<Grid ${ns}><Grid.Unknown><Button /></Grid.Unknown></Grid>`]) {
    const fixture = xamlFixture();
    assert.throws(() => new XamlObjectWriter(fixture.schema).load(source), XamlParseException);
    assert.equal(fixture.created(), 0);
  }
});

test('XAML: initial template validation checks deferred properties, while ordinary Load keeps resource activation deferred', () => {
  const fixture = xamlFixture();
  const loader = new XamlObjectWriter(fixture.schema);
  const source = `<DataTemplate ${ns}><Button Unsupported="1" /></DataTemplate>`;
  const result = loader.load(source);
  assert.equal(fixture.created(), 0);
  assert.throws(() => loader.load(source, {initialTemplateValidation: true}), {code: 'SFXAML054'});
  assert.throws(() => result.root.instantiate(), {code: 'SFXAML054'});
});

test('XAML: a forward StaticResource and unregistered code-first deferred serialization produce explicit diagnostics', () => {
  const fixture = xamlFixture();
  const loader = new XamlObjectWriter(fixture.schema);
  const result = loader.load(`<ResourceDictionary ${ns}><Button x:Key="First" Content="{StaticResource Later}" /><x:String x:Key="Later">late</x:String></ResourceDictionary>`);
  assert.throws(() => result.root.get('First'), error => error.code === 'SFXAML050' && error.cause?.code === 'SFRES013');
});
