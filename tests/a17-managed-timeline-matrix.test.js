import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const kinds = {
  Double: {target: 'Button target = new Button { Width = 0 };', property: 'Width', read: 'target.Width', from: '0', to: '100', maximum: 100},
  Point: {target: 'LineSegment target = new LineSegment { Point = new Point(0, 0) };', property: 'Point', read: 'target.Point.Y',
    from: 'new Point(0, 0)', to: 'new Point(20, 40)', maximum: 40},
  Color: {target: 'SolidColorBrush target = new SolidColorBrush(Colors.Black);', property: 'Color', read: 'target.Color.R',
    from: 'Colors.Black', to: 'Colors.Red', maximum: 255},
  Object: {target: 'Button target = new Button { Content = "before" };', property: 'Content', read: 'target.Content',
    from: '"before"', to: '"after"'}
};
const specifications = Object.keys(kinds).flatMap(kind => (kind === 'Object' ? ['Discrete'] : ['Linear', 'Discrete', 'Easing', 'Spline'])
  .map(mode => ({id: kind + '-' + mode, kind, mode}))).concat(['Color', 'Point'].map(kind => ({id: kind + '-simple', kind, mode: 'simple'})));
const sampleTimes = Array.from({length: 20}, (_, index) => index * 50);

function body({id, kind, mode}) {
  const value = kinds[kind], type = kind + (mode === 'simple' ? 'Animation' : 'AnimationUsingKeyFrames');
  const easing = mode === 'Easing' ? ', EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn }' : mode === 'Spline'
    ? ', KeySpline = new KeySpline(1.0 / 3, 0, 2.0 / 3, 1.0 / 3)' : '';
  const frames = mode === 'simple' ? `animation.From = ${value.from}; animation.To = ${value.to};` : `
    animation.KeyFrames.Add(new ${kind === 'Object' ? 'Discrete' : 'Linear'}${kind}KeyFrame {
        KeyTime = KeyTime.FromTimeSpan(TimeSpan.Zero), Value = ${value.from} });
    animation.KeyFrames.Add(new ${mode}${kind}KeyFrame {
        KeyTime = KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(${mode === 'Discrete' ? 500 : 1000})), Value = ${value.to}${easing} });`;
  return `{
    Console.WriteLine("${id}");
    ${value.target}
    ${type} animation = new ${type} { Duration = new Duration(TimeSpan.FromSeconds(1)), EnableDependentAnimation = true };
    ${frames}
    Storyboard.SetTarget(animation, target);
    Storyboard.SetTargetProperty(animation, "${value.property}");
    Storyboard storyboard = new Storyboard();
    storyboard.Children.Add(animation);
    storyboard.Begin();
    for (int sample = 0; sample < 20; sample++) {
        storyboard.Seek(TimeSpan.FromMilliseconds(sample * 50));
        Console.WriteLine(${value.read});
    }
    ${mode === 'Discrete' ? [499.999, 500, 500.001].map(time =>
      `storyboard.Seek(TimeSpan.FromMilliseconds(${time})); Console.WriteLine(${value.read});`).join('\n') : ''}
    storyboard.Stop();
  }`;
}

const prefix = `using System; using Microsoft.UI; using Microsoft.UI.Xaml; using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media; using Microsoft.UI.Xaml.Media.Animation; using Windows.Foundation;
`;
const source = prefix + 'class Program { static void Main() { ' + specifications.map(body).join('\n') + ' } }';
const paths = prefix + `
Grid target = new Grid { Width = 100, Background = new SolidColorBrush(Colors.Black), RenderTransform = new CompositeTransform() };
DoubleAnimation move = new DoubleAnimation { From = 0, To = 20, Duration = new Duration(TimeSpan.FromSeconds(1)) };
ColorAnimation color = new ColorAnimation { From = Colors.Black, To = Colors.Red, Duration = new Duration(TimeSpan.FromSeconds(1)) };
Storyboard.SetTarget(move, target);
Storyboard.SetTargetProperty(move, "(UIElement.RenderTransform).(CompositeTransform.TranslateX)");
Storyboard.SetTarget(color, target);
Storyboard.SetTargetProperty(color, "(Panel.Background).(SolidColorBrush.Color)");
Storyboard storyboard = new Storyboard(); storyboard.Children.Add(move); storyboard.Children.Add(color);
storyboard.Begin(); SharpForge.UI.AnimationClock.AdvanceBy(250);
Console.WriteLine(((CompositeTransform)target.RenderTransform).TranslateX);
Console.WriteLine(((SolidColorBrush)target.Background).Color.R);
DoubleAnimation invalid = new DoubleAnimation { From = 0, To = 99, Duration = new Duration(TimeSpan.FromSeconds(1)) };
Storyboard.SetTarget(invalid, target);
Storyboard.SetTargetProperty(invalid, "(Panel.Background).(SolidColorBrush.Missing)");
storyboard.Children.Add(invalid);
try { storyboard.Begin(); } catch (Exception) { Console.WriteLine("invalid-path"); }
SharpForge.UI.AnimationClock.AdvanceBy(250);
Console.WriteLine(((CompositeTransform)target.RenderTransform).TranslateX);
Console.WriteLine(((SolidColorBrush)target.Background).Color.R);
Console.WriteLine(target.Width);
storyboard.Stop();
`;
const builds = new Map();
function program(text) {
  if (!builds.has(text)) {
    const built = compileToIL(text);
    assert.equal(built.success, true, JSON.stringify(built.diagnostics));
    builds.set(text, built);
  }
  return builds.get(text);
}
const engines = {source: built => new VirtualMachine(built.image), reload: built => new VirtualMachine(loadAssembly(built.assembly)),
  CIL: built => new CilVirtualMachine(built.assembly)};

function expected({kind, mode}, time) {
  if (mode === 'Discrete') return kind === 'Object' ? time < 500 ? 'before' : 'after' : time < 500 ? 0 : kinds[kind].maximum;
  const progress = time / 1000, factor = ['Easing', 'Spline'].includes(mode) ? progress * progress : progress;
  const value = kinds[kind].maximum * factor;
  return kind === 'Color' ? Math.round(value) : value;
}

for (const [engine, create] of Object.entries(engines)) {
  test(engine + ': every supported XAML keyframe family matches twenty independent samples and exact discrete KeyTime edges', () => {
    const vm = create(program(source));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      const rows = result.output.trimEnd().split('\n');
      let index = 0;
      for (const specification of specifications) {
        assert.equal(rows[index++], specification.id);
        const times = specification.mode === 'Discrete' ? [...sampleTimes, 499.999, 500, 500.001] : sampleTimes;
        for (const time of times) {
          const reference = expected(specification, time), actual = rows[index++];
          if (typeof reference === 'string') assert.equal(actual, reference, specification.id + '@' + time);
          else assert.ok(Math.abs(Number(actual) - reference) <= 1e-6,
            specification.id + '@' + time + ': ' + actual + ' != ' + reference);
        }
      }
      assert.equal(index, rows.length);
    } finally { vm.stop(); }
  });

  test(engine + ': qualified transform and brush paths animate together and invalid Begin preserves the running storyboard', () => {
    const vm = create(program(paths));
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', JSON.stringify(result.fault));
      assert.equal(result.output, '5\n64\ninvalid-path\n10\n128\n100\n');
    } finally { vm.stop(); }
  });
}
