import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameworkXamlSchema, XamlObjectWriter, XamlSchema, PRESENTATION_NAMESPACE} from '@sharpforge/winui-properties';

const controls = 'Microsoft.UI.Xaml.Controls.';

function fixture() {
  const types = [
    {name: controls + 'Button', kind: 'control', properties: {Content: {type: 'object'}}},
    {name: controls + 'ScrollPresenter', kind: 'control', xamlNamespace: 'using:Microsoft.UI.Xaml.Controls'},
    {name: controls + 'Primitives.ScrollPresenter', kind: 'control'}
  ];
  const created = [];
  const schema = createFrameworkXamlSchema({registry: {types: new Map(types.map(type => [type.name, type])), contracts: []},
    create: type => { created.push(type); return {valueType: type}; },
    get: (owner, name) => owner[name], set: (owner, name, value) => { owner[name] = value; },
    add: (owner, value) => owner.push(value)});
  return {schema, created, loader: new XamlObjectWriter(schema)};
}

test('XAML namespaces distinguish the native presentation type from an explicit legacy CLR namespace', () => {
  const {schema, loader} = fixture();
  const native = controls + 'Primitives.ScrollPresenter';
  assert.equal(schema.resolve(PRESENTATION_NAMESPACE, 'ScrollPresenter').name, native);
  assert.equal(schema.resolve('using:Microsoft.UI.Xaml.Controls.Primitives', 'ScrollPresenter').name, native);
  assert.equal(schema.resolve('using:Microsoft.UI.Xaml.Controls', 'ScrollPresenter').name, controls + 'ScrollPresenter');
  for (const [namespace, expected] of [[PRESENTATION_NAMESPACE, native], ['using:Microsoft.UI.Xaml.Controls.Primitives', native],
    ['using:Microsoft.UI.Xaml.Controls', controls + 'ScrollPresenter']]) {
    const result = loader.load(`<ScrollPresenter xmlns="${namespace}"/>`);
    assert.equal(result.root.valueType, expected);
    result.lifetime.dispose();
  }
});

test('XAML CLR namespace aliases share resource builders and accept equivalent property-element prefixes', () => {
  const {loader} = fixture();
  const result = loader.load(`<r:ResourceDictionary xmlns:r="using:Microsoft.UI.Xaml" xmlns:p="${PRESENTATION_NAMESPACE}"
    xmlns:c="using:Microsoft.UI.Xaml.Controls" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
    <p:ResourceDictionary.MergedDictionaries><r:ResourceDictionary>
      <x:String x:Key="label">merged</x:String>
    </r:ResourceDictionary></p:ResourceDictionary.MergedDictionaries>
    <r:Style x:Key="button" TargetType="c:Button"><p:Style.Setters>
      <r:Setter Property="Content" Value="hello"/>
    </p:Style.Setters></r:Style>
  </r:ResourceDictionary>`);
  assert.equal(result.root.get('label'), 'merged');
  assert.equal(result.root.get('button').targetType, controls + 'Button');
  assert.equal(result.root.get('button').setters[0].value, 'hello');
  result.lifetime.dispose();
});

test('XAML aliases cannot activate unregistered types or replace an admitted constructor', () => {
  const {loader, created} = fixture();
  assert.throws(() => loader.load('<Process xmlns="using:System.Diagnostics"/>'), {code: 'SFXAML045'});
  assert.deepEqual(created, []);
  const schema = new XamlSchema(), first = schema.register({name: 'Example.First'});
  const second = schema.register({name: 'Example.Second'});
  schema.registerAlias('using:Example', 'Shared', first);
  assert.throws(() => schema.registerAlias('using:Example', 'Shared', second), /already resolves/);
  assert.throws(() => schema.registerAlias('using:Example', 'Unknown', {name: 'Unregistered'}), /registered XAML type/);
  assert.equal(schema.resolve('using:Example', 'Shared'), first);
});
