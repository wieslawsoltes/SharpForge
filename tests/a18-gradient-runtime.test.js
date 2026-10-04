import test from 'node:test';
import assert from 'node:assert/strict';
import {contracts, findContracts, frameworkAssignable, propertiesFor, MEDIA} from '@sharpforge/framework';
import {frameworkBuiltin} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, applyDesignPatch} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {DesignDocument, bindLinkedLiveDesign, designFromScene, designPatch, readDesignSource,
  normalizeDesignerBrush} from '@sharpforge/designer';
import {gradientBrush, gradientSources, compileGradient, gradientVisual, gradientReference} from './fixtures/a18-gradients.js';

const point = 'Windows.Foundation.Point';
const stop = MEDIA + 'GradientStop';
const collection = MEDIA + 'GradientStopCollection';
const linear = MEDIA + 'LinearGradientBrush';
const gradient = MEDIA + 'GradientBrush';

test('A18 gradient contracts retain exact reserved IDs and use inherited Brush properties with both dispatch tables', () => {
  const expected = [
    [point, '.ctor', ['double', 'double']], [point, 'get_X', []], [point, 'get_Y', []],
    [stop, '.ctor', []], [stop, 'get_Color', []], [stop, 'set_Color', ['Windows.UI.Color']],
    [stop, 'get_Offset', []], [stop, 'set_Offset', ['double']],
    [collection, '.ctor', []], [collection, 'get_Count', []], [collection, 'Add', [stop]], [collection, 'Clear', []],
    [collection, 'Remove', [stop]], [collection, 'RemoveAt', ['int']], [collection, 'Insert', ['int', stop]],
    [collection, 'get_Item', ['int']], [gradient, 'get_GradientStops', []], [gradient, 'set_GradientStops', [collection]],
    [linear, '.ctor', []], [linear, 'get_StartPoint', []], [linear, 'set_StartPoint', [point]],
    [linear, 'get_EndPoint', []], [linear, 'set_EndPoint', [point]]
  ];
  const actual = contracts.filter(contract => contract.id >= 1245202 && contract.id <= 1245224);
  assert.equal(actual.length, 23);
  assert.deepEqual(actual.map(contract => [contract.owner, contract.name, contract.parameters]), expected);
  for (const [index, contract] of actual.entries()) {
    assert.equal(contract.id, 1245202 + index);
    assert.strictEqual(frameworkBuiltin(contract).contract, contract);
  }
  assert.equal(new Set(contracts.map(contract => contract.id)).size, contracts.length);
  assert.equal(frameworkAssignable(MEDIA + 'Brush', linear), true);
  const properties = propertiesFor(linear);
  assert.equal(properties.Opacity.type, 'double');
  assert.equal(properties.GradientStops.type, collection);
  assert.equal(properties.GradientStops.readOnly, false);
  assert.equal(properties.StartPoint.type, point);
  assert.equal(propertiesFor(point).X.readOnly, true);
  assert.equal(findContracts(linear, 'set_Opacity').length, 1);
});

const prefix = `using System;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI;
using Windows.Foundation;
`;

function compileBody(body) {
  const compiled = compileToIL(prefix + 'class PaintProgram { static void Main() { ' + body + ' } }');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  return compiled;
}

const mutationProgram = `
  GradientStop red = new GradientStop() { Color = Colors.Red, Offset = 0 };
  GradientStop blue = new GradientStop() { Color = Colors.Blue, Offset = 1 };
  LinearGradientBrush brush = new LinearGradientBrush() { GradientStops = new GradientStopCollection() { red, blue } };
  Button first = new Button() { Name = "Action", Background = brush };
  Button second = new Button() { Name = "Other", Background = brush };
  StackPanel panel = new StackPanel(); panel.Children.Add(first); panel.Children.Add(second);
  Window window = new Window() { Content = panel }; window.Activate();
  brush.StartPoint = new Point(-0.5, 0.25); brush.EndPoint = new Point(1.5, 0.75); brush.Opacity = 0.5;
  red.Color = Colors.Green; red.Offset = 0.25;
  brush.GradientStops.RemoveAt(1);
  brush.GradientStops.Insert(0, blue);
  Console.WriteLine(brush.GradientStops.Count);
  Console.WriteLine(brush.GradientStops[1] == red);
  Console.WriteLine(brush.GradientStops.Remove(blue));
  brush.GradientStops.Add(blue);
  Console.WriteLine(brush.StartPoint.X);
  Console.WriteLine(brush.EndPoint.Y);
  GC.Collect();
`;

for (const Machine of [VirtualMachine, CilVirtualMachine]) {
  test(Machine.name + ': C# gradient mutations preserve shared identity, publish updated consumers and survive collection', () => {
    const compiled = compileBody(mutationProgram);
    const commands = [];
    const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly,
      {initialThreshold: 64, onUICommand: command => commands.push(command)});
    const result = machine.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output.replaceAll('\r', ''), '2\nTrue\nTrue\n-0.5\n0.75\n');
    const expected = gradientBrush({StartPoint: {X: -0.5, Y: 0.25}, EndPoint: {X: 1.5, Y: 0.75}, Opacity: 0.5,
      GradientStops: [{Color: '#ff008000', Offset: 0.25}, {Color: '#ff0000ff', Offset: 1}]});
    for (const name of ['Action', 'Other']) {
      assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine, name).properties.Background), expected);
    }
    const first = gradientReference(gradientVisual(machine).id);
    const other = gradientReference(gradientVisual(machine, 'Other').id);
    assert.deepEqual(machine.platform.get(first, 'Background'), machine.platform.get(other, 'Background'));
    const reset = commands.filter(command => command.op === 'reset').at(-1);
    assert.ok(reset, 'Mutating nested values must invalidate detached scene consumers');
    assert.deepEqual(normalizeDesignerBrush(reset.snapshot.nodes.find(node => node.properties.Name === 'Action').properties.Background),
      expected);
    machine.heap.collect();
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(machine).properties.Background), expected);
  });

  test(Machine.name + ': native empty/one-stop collections and invalid setters preserve the previous managed state', () => {
    const compiled = compileBody(`
      LinearGradientBrush brush = new LinearGradientBrush();
      Button button = new Button() { Name = "Action", Background = brush };
      Window window = new Window() { Content = button }; window.Activate();
      Console.WriteLine(brush.GradientStops.Count);
      GradientStop item = new GradientStop();
      brush.GradientStops.Add(item);
      Console.WriteLine(item.Color.A);
      try { item.Offset = -0.1; } catch (Exception exception) { Console.WriteLine("offset"); }
      try { brush.Opacity = 1.1; } catch (Exception exception) { Console.WriteLine("opacity"); }
      try { brush.StartPoint = new Point(100001, 0); } catch (Exception exception) { Console.WriteLine("point"); }
      try { brush.GradientStops.Add(null); } catch (Exception exception) { Console.WriteLine("null"); }
      try { brush.GradientStops.RemoveAt(5); } catch (Exception exception) { Console.WriteLine("index"); }
      Console.WriteLine(brush.GradientStops.Count);
      Console.WriteLine(item.Offset);
      Console.WriteLine(brush.Opacity);
      brush.GradientStops.Clear();
      Console.WriteLine(brush.GradientStops.Count);
    `);
    const machine = new Machine(Machine === VirtualMachine ? compiled.image : compiled.assembly);
    const result = machine.run();
    assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
    assert.equal(result.output.replaceAll('\r', ''), '0\n0\noffset\nopacity\npoint\nnull\nindex\n1\n0\n1\n0\n');
    const value = gradientVisual(machine).properties.Background;
    assert.deepEqual(value.GradientStops, []);
    assert.equal(value.StartPoint.X, 0);
    assert.equal(value.StartPoint.Y, 0);
    assert.equal(value.Opacity, 1);
  });
}

for (const Session of [DebugSession, CilDebugSession]) {
  test(Session.name + ': live collection items and template parts receive complete managed gradients', () => {
    const compiled = compileGradient(gradientSources());
    const session = new Session(Session === DebugSession ? compiled.image : compiled.assembly);
    session.start(false);
    session.runUntilStop();
    const before = designFromScene(session.vm.platform.scene());
    const document = new DesignDocument(before);
    const action = document.value.nodes.find(node => node.properties.Name === 'Action');
    const root = document.value.nodes.find(node => node.properties.Name === 'Root');
    const brush = gradientBrush({Opacity: 0.3});
    const choices = document.add('ComboBox', root.id, {Name: 'Choices'});
    document.change('Author gradient item', draft => {
      draft.nodes.find(node => node.id === choices).collections = {Items: [
        {type: 'ComboBoxItem', properties: {Name: 'PaintItem', Content: 'Paint', Background: brush}}
      ]};
    });
    document.setTemplate('PaintFrame', {targetType: 'Button', root: {id: 'frame', type: 'Border',
      properties: {Name: 'PaintFrame', Background: brush}, children: []}});
    document.setReference('template', 'PaintFrame', [action.id]);
    const patch = designPatch(before, document.value);
    assert(patch.commands.some(command => command.op === 'collection'));
    assert(patch.commands.some(command => command.op === 'template'));
    applyDesignPatch(session, patch);
    for (const name of ['PaintItem', 'PaintFrame']) {
      assert.deepEqual(normalizeDesignerBrush(gradientVisual(session.vm, name).properties.Background), brush);
    }
    session.vm.heap.collect();
    assert.equal(gradientVisual(session.vm).id, action.runtimeId);
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(session.vm, 'PaintFrame').properties.Background), brush);
    document.dispose();
  });

  test(Session.name + ': live gradient edits materialize real brush graphs atomically and retain source-owned bindings', () => {
    const sources = gradientSources(normalizeDesignerBrush('#ff102030'));
    const compiled = compileGradient(sources);
    const session = new Session(Session === DebugSession ? compiled.image : compiled.assembly, {initialThreshold: 64});
    session.start(false);
    session.runUntilStop();
    const scene = session.vm.platform.scene();
    const analysis = readDesignSource(sources[0].text);
    const linked = bindLinkedLiveDesign(analysis.document, designFromScene(scene), {scene});
    const document = new DesignDocument(linked.document);
    const action = document.value.nodes.find(node => node.properties.Name === 'Action');
    const brush = gradientBrush();
    document.setProperty('Background', brush, [action.id]);
    const patch = designPatch(linked.baseline, document.value);
    assert.deepEqual(patch.commands.map(command => command.op), ['set']);
    const result = applyDesignPatch(session, patch, {expectedRevision: 0});
    assert.equal(result.revision, 1);
    assert.equal(gradientVisual(session.vm).id, action.runtimeId);
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(session.vm).properties.Background), brush);
    const platform = session.vm.platform;
    const reference = platform.get(gradientReference(action.runtimeId), 'Background');
    assert.equal(platform.record(reference).type, linear);
    const stops = platform.get(reference, 'GradientStops');
    assert.equal(platform.record(stops).type, collection);
    assert.equal(platform.items(stops).length, brush.GradientStops.length);
    session.vm.heap.collect();
    assert.deepEqual(normalizeDesignerBrush(gradientVisual(session.vm).properties.Background), brush);
    const before = structuredClone(platform.scene());
    const failing = {...patch, commands: [{...patch.commands[0], value: gradientBrush({Opacity: 0.1})},
      {op: 'set', id: action.id, property: 'MissingProperty', value: 1}]};
    const emitted = [];
    platform.options.onUICommand = command => emitted.push(command);
    assert.throws(() => applyDesignPatch(session, failing, {expectedRevision: 1}), /Unknown property/);
    assert.deepEqual(platform.scene(), before);
    assert.deepEqual(emitted, []);
    assert.equal(session.designRevision, 1);
    assert.throws(() => applyDesignPatch(session, patch, {expectedRevision: 0}), /revision/i);
    assert.deepEqual(platform.scene(), before);
    document.dispose();
  });
}
