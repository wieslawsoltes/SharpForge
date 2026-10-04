import test from 'node:test';
import assert from 'node:assert/strict';
import {convertXamlValue, XamlObjectWriter, XamlWriter} from '@sharpforge/winui-properties';
import {xamlFixture} from './helpers/a15-resource-fixtures.js';

const namespace = 'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"';

test('XAML type conversion never interprets inherited JavaScript members as registered types', () => {
  const types = {Visibility: {name: 'Visibility', values: {Visible: 0, Collapsed: 1}}};
  const context = {type: name => types[name]};
  for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => convertXamlValue('x', name, context), {code: 'SFXAML032'});
  }
  assert.equal(convertXamlValue('Visible', 'Visibility', context), 0);
  assert.throws(() => convertXamlValue('constructor', 'Visibility', context), {code: 'SFXAML033'});
  assert.throws(() => convertXamlValue('constructor', 'FontWeight'), {code: 'SFXAML020'});
});

test('XAML serialization defaults preserve collections and edited null without an own valueOf callback', () => {
  const {schema} = xamlFixture();
  const loader = new XamlObjectWriter(schema);
  const loaded = loader.load(`<Grid ${namespace}><Button Content="first" /><Button Content="second" /></Grid>`);
  loaded.root.Children[0].Content = null;
  for (const options of [{}, {typeOf: value => value.valueType}, {valueOf: undefined},
    Object.create({valueOf() { throw new Error('An inherited callback must not execute.'); }})]) {
    const saved = new XamlWriter(schema, options).save(loaded.root);
    const restored = loader.load(saved);
    assert.equal(restored.root.Children.length, 2, saved);
    assert.equal(restored.root.Children[0].Content, null);
    assert.equal(restored.root.Children[1].Content, 'second');
    restored.lifetime.dispose();
  }
  loaded.lifetime.dispose();
});

test('XAML serialization honors an explicitly supplied value projection', () => {
  const {schema} = xamlFixture();
  const loader = new XamlObjectWriter(schema);
  const loaded = loader.load(`<TextBlock ${namespace} Text="label" />`);
  const writer = new XamlWriter(schema, {valueOf: (value, type) => type === 'string' ? value.toUpperCase() : value});
  const restored = loader.load(writer.save(loaded.root));
  assert.equal(restored.root.Text, 'LABEL');
  restored.lifetime.dispose();
  loaded.lifetime.dispose();
});
