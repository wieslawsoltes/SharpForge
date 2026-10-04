import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {DisplayList} from '../packages/rendering/src/drawing/display-list.js';
import {DrawOp} from '../packages/rendering/src/drawing/commands.js';

const customBrush = readFileSync(new URL('./fixtures/rendering/custom-brush.cs', import.meta.url), 'utf8');
const prefix = 'using Microsoft.UI; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Media; using Windows.Foundation; using Windows.UI;';
const geometry = prefix + `
  LineSegment segment = new LineSegment();
  Console.WriteLine(segment.Point.X);
  segment.Point = new Point(3, 4);
  Console.WriteLine(((Point)segment.GetValue(LineSegment.PointProperty)).Y);
  SolidColorBrush brush = new SolidColorBrush(Colors.Red);
  Console.WriteLine(((Color)brush.GetValue(SolidColorBrush.ColorProperty)).R);
  brush.SetValue(SolidColorBrush.ColorProperty, Colors.Blue);
  Console.WriteLine(brush.Color.B);
  TranslateTransform transform = new TranslateTransform { X = 10, Y = -5 };
  Point result;
  Console.WriteLine(transform.TryTransform(new Point(2, 3), out result));
  Console.WriteLine(result.X);
  Console.WriteLine(result.Y);
  PathFigure figure = new PathFigure { StartPoint = new Point(0, 0), IsClosed = true };
  figure.Segments.Add(new LineSegment { Point = new Point(20, 0) });
  figure.Segments.Add(new LineSegment { Point = new Point(20, 10) });
  figure.Segments.Add(new LineSegment { Point = new Point(0, 10) });
  PathGeometry path = new PathGeometry();
  path.Figures.Add(figure);
  Console.WriteLine(path.Bounds.Width);
  Console.WriteLine(path.FillContains(new Point(10, 5)));
  Console.WriteLine(path.FillContains(new Point(30, 5)));
`;
const canvas = `using Microsoft.UI; using Microsoft.UI.Xaml; using Microsoft.Graphics.Canvas.UI.Xaml;
class Program {
  static void Draw(CanvasControl sender, CanvasDrawEventArgs args) {
    args.DrawingSession.Clear(Colors.Transparent);
    args.DrawingSession.DrawLine(0, 0, 20, 30, Colors.Red, 2);
    args.DrawingSession.FillRectangle(2, 3, 8, 9, Colors.Blue);
    args.DrawingSession.DrawEllipse(30, 30, 10, 5, Colors.Green, 1);
  }
  static void Main() {
    CanvasControl canvas = new CanvasControl { Name = "canvas" };
    canvas.Draw += Draw;
    Window window = new Window { Content = canvas };
    window.Activate();
  }
}`;
const built = new Map();
function compiled(source) {
  if (!built.has(source)) {
    const result = compileToIL(source);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    built.set(source, result);
  }
  return built.get(source);
}
const engines = {
  source: (build, options) => new VirtualMachine(build.image, options),
  reload: (build, options) => new VirtualMachine(loadAssembly(build.assembly), options),
  CIL: (build, options) => new CilVirtualMachine(build.assembly, options)
};
const byName = (vm, name) => vm.platform.scene().nodes.find(node => node.properties.Name === name);
const options = {virtualTime: true, initialThreshold: 64};

for (const [name, create] of Object.entries(engines)) {
  test(name + ': rendering models share typed DP values, collection mutations, native geometry and byref results', async () => {
    const vm = create(compiled(geometry), options);
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '0\n4\n255\n255\nTrue\n12\n-2\n20\nTrue\nFalse\n');
    vm.stop();
  });

  test(name + ': custom brush base construction, gradient projection, GC, disconnect and snapshot restoration', async () => {
    const vm = create(compiled(customBrush), options);
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '1\nTrue\n');
    const background = byName(vm, 'first').properties.Background;
    assert.equal(background.CompositionBrush.kind, 'CompositionLinearGradientBrush');
    assert.equal(background.CompositionBrush.ColorStops.length, 2);
    const snapshot = vm.snapshot();
    const disconnect = async () => {
      vm.platform.dispatchEvent(byName(vm, 'disconnect').id, 'Click');
      const ended = await vm.runAsync();
      assert.equal(ended.state, 'terminated', ended.fault?.message);
      assert.equal(ended.output, '1\nTrue\n1\n1\n');
      assert.equal(byName(vm, 'first').properties.Background, null);
    };
    await disconnect();
    vm.restore(snapshot); vm.state = 'terminated';
    assert.equal(byName(vm, 'first').properties.Background.CompositionBrush.ColorStops.length, 2);
    await disconnect();
    vm.heap.collect(); vm.stop();
  });

  test(name + ': Canvas Draw emits a data-only list with stable owner/version and the supported Win2D subset', async () => {
    const commands = [], vm = create(compiled(canvas), {...options, onUICommand: command => commands.push(command)});
    const result = await vm.runAsync();
    assert.equal(result.state, 'terminated', result.fault?.message);
    const target = byName(vm, 'canvas');
    vm.platform.dispatchEvent(target.id, 'Draw');
    await vm.runAsync();
    const flatten = values => values.flatMap(value => value.commands ? flatten(value.commands) : [value]);
    const first = flatten(commands).filter(command => command.op === 'displayList').at(-1);
    assert.ok(first);
    const list = DisplayList.from(first.displayList);
    assert.equal(list.elementId, target.id);
    assert.deepEqual(list.commands.map(command => command.op), [DrawOp.Clear, DrawOp.Line, DrawOp.Rectangle, DrawOp.Ellipse]);
    assert.equal(list.commands[3].brush, null);
    const snapshot = vm.snapshot();
    vm.platform.dispatchEvent(target.id, 'Draw'); await vm.runAsync();
    const second = flatten(commands).filter(command => command.op === 'displayList').at(-1);
    assert.equal(DisplayList.from(second.displayList).version, list.version + 1);
    vm.restore(snapshot); vm.state = 'terminated';
    vm.platform.dispatchEvent(target.id, 'Draw'); await vm.runAsync();
    const restored = flatten(commands).filter(command => command.op === 'displayList').at(-1);
    assert.equal(DisplayList.from(restored.displayList).version, list.version + 1);
    vm.stop();
  });
}
