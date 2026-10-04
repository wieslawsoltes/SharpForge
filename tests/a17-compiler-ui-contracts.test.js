import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {createRegistry, findContracts, frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {registerDrawingPropertyIdentifiers} from '@sharpforge/rendering';
import {decodeCoded, loadAssembly, readPE} from '@sharpforge/cil';
import {propertyEngines} from './helpers/a15-property-managed-fixture.js';

function build(source) {
  const result = compileToIL(source);
  assert.equal(result.success, true, result.diagnostics.map(value => value.code + ': ' + value.message).join('\n'));
  return result;
}

test('A17 dependency-property identifier completion appends stable handles once and excludes non-DO data', () => {
  const registry = createRegistry({reservations: [{name: 'fixture', start: 100, size: 64}]});
  let previous;
  registry.register({name: 'fixture', register(value) {
    const object = value.XAML + 'DependencyObject';
    value.define(object);
    value.define(value.XAML + 'DependencyProperty');
    value.define('Drawing', {base: object});
    value.define('CollectionData');
    value.prop('Drawing', 'Value', 'int', 0);
    value.prop('Drawing', 'Count', 'int', 0, true);
    value.prop('CollectionData', 'Value', 'int', 0);
    previous = [...value.contracts];
    registerDrawingPropertyIdentifiers(value);
    const count = value.contracts.length;
    registerDrawingPropertyIdentifiers(value);
    assert.equal(value.contracts.length, count);
  }});
  assert.deepEqual(registry.contracts.slice(0, previous.length), previous);
  const added = registry.contracts.slice(previous.length);
  assert.equal(added.length, 1);
  assert.equal(added[0].id, previous.at(-1).id + 1);
  assert.equal(added[0].name, 'get_ValueProperty');
  assert.equal(added[0].owner, 'Drawing');
  assert.equal(added[0].isStatic, true);
  assert.equal(added[0].result, 'Microsoft.UI.Xaml.DependencyProperty');
  assert.equal(registry.types.get('Drawing').properties.CountProperty, undefined);
  assert.equal(registry.types.get('CollectionData').properties.ValueProperty, undefined);
});

test('A17 drawing contracts expose real DependencyObject ancestry and declared-owner property handles', () => {
  const object = 'Microsoft.UI.Xaml.DependencyObject';
  for (const [name, property] of [['SolidColorBrush', 'Color'], ['LineSegment', 'Point'], ['TranslateTransform', 'X']]) {
    const owner = 'Microsoft.UI.Xaml.Media.' + name;
    assert.equal(frameworkAssignable(object, owner), true, owner);
    assert.equal(findContracts(owner, 'GetValue', false)[0].owner, object);
    const handle = findContracts(owner, 'get_' + property + 'Property', true)[0];
    assert.equal(handle.owner, owner);
    assert.equal(handle.result, 'Microsoft.UI.Xaml.DependencyProperty');
  }
  assert.equal(frameworkType('Microsoft.UI.Xaml.Media.Brush').base, object);
  assert.equal(findContracts('Microsoft.UI.Composition.CompositionBrush', 'GetValue', false).length, 0);
});

test('A17 Canvas typed callbacks emit canonical delegates and real WinUI-scoped token anchors', () => {
  const built = build(`using Microsoft.UI.Xaml; using Microsoft.Graphics.Canvas.UI.Xaml;
    class DrawOwner : Microsoft.UI.Xaml.Controls.Control {
      public int Calls;
      public void Draw(CanvasControl sender, CanvasDrawEventArgs args) { Calls++; }
    }
    class P {
      static void Main() {
        DrawOwner owner = new DrawOwner(); CanvasControl canvas = new CanvasControl(); canvas.Draw += owner.Draw;
      }
    }`);
  const decoded = loadAssembly(built.assembly);
  assert(decoded.types.some(type => type.delegateContract === 'Microsoft.Graphics.Canvas.UI.Xaml.CanvasDrawEventHandler'));
  const metadata = readPE(built.assembly).metadata;
  const owner = 'Microsoft.Graphics.Canvas.CanvasDrawingSession';
  const row = metadata.rows[10].find(value => metadata.string(value[1]) === 'DrawText' &&
    metadata.typeName(decodeCoded('MemberRefParent', value[0])) === owner);
  assert(row, 'Unreferenced supported methods need real tokens for compiled XAML binding');
  const type = metadata.row(decodeCoded('MemberRefParent', row[0]));
  const scope = decodeCoded('ResolutionScope', type[0]);
  assert.equal(scope >>> 24, 35);
  assert.equal(metadata.string(metadata.row(scope)[6]), 'SharpForge.WinUI');
});

test('A17 released Canvas callback lowering retains the declared delegate constructor through canonical reload', () => {
  const built = build(`using Microsoft.Graphics.Canvas.UI.Xaml;
    class P {
      static void Draw(CanvasControl sender, CanvasDrawEventArgs args) { }
      static void Main() { CanvasControl canvas = new CanvasControl(); canvas.Draw += Draw; }
    }`);
  for (const image of [built.image, loadAssembly(built.assembly)]) {
    const delegates = [];
    for (const method of image.methods) {
      for (let offset = 0; offset < method.code.length; offset += 3) {
        if (method.code[offset] === Op.DELEGATE) delegates.push(image.constants[method.code[offset + 2]]);
      }
    }
    assert.deepEqual(delegates, ['Microsoft.Graphics.Canvas.UI.Xaml.CanvasDrawEventHandler']);
  }
});

test('A17 registered composition reference conversions preserve values and checked type tests on every engine', () => {
  const built = build(`using System; using Microsoft.UI.Composition;
    class P {
      static CompositionBrush Up(CompositionLinearGradientBrush value) { return value; }
      static void Main() {
        Compositor compositor = new Compositor();
        CompositionBrush brush = Up(compositor.CreateLinearGradientBrush());
        Console.WriteLine(brush is CompositionLinearGradientBrush);
        Console.WriteLine(brush as CompositionColorBrush == null);
        Console.WriteLine(object.ReferenceEquals(brush, (CompositionLinearGradientBrush)brush));
      }
    }`);
  for (const [name, vm] of propertyEngines(built)) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', name + ': ' + JSON.stringify(result.fault));
    assert.equal(result.output, 'True\nTrue\nTrue\n', name);
  }
});
