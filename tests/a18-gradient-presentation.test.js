import test from 'node:test';
import assert from 'node:assert/strict';
import {createWinUIApp, normalizeLinearGradientBrush, linearGradientSvg} from '@sharpforge/winui';
import {geometryHost, canvasScene} from './fixtures/a18-host-geometry-dom.js';
import {sessionDom} from './fixtures/a18-session-dom.js';

const media = 'Microsoft.UI.Xaml.Media.';
const color = (red, green = 0, blue = 0, alpha = 255) => ({valueType: 'Windows.UI.Color', A: alpha, R: red, G: green, B: blue});
const gradient = (overrides = {}) => ({
  valueType: media + 'LinearGradientBrush', StartPoint: {X: .25, Y: .5}, EndPoint: {X: .75, Y: 1}, Opacity: .5,
  GradientStops: [{Color: color(255), Offset: 0}, {Color: color(0, 0, 255, 128), Offset: 1}], ...overrides
});
const images = element => [...element.style.backgroundImage.matchAll(/url\("data:image\/svg\+xml,([^"]*)"\)/g)]
  .map(match => decodeURIComponent(match[1]));

function appFixture() {
  const {document} = sessionDom();
  let frame = 0;
  document.defaultView.requestAnimationFrame = () => ++frame;
  document.defaultView.cancelAnimationFrame = () => {};
  const app = createWinUIApp(document.createElement('div'), {backend: 'dom'});
  return {app, media: app.Microsoft.UI.Xaml.Media, Point: app.Windows.Foundation.Point, Color: app.Windows.UI.Color};
}

test('portable SVG uses physical pixel endpoints, pad, sRGB and multiplied alpha with stable equal stops', () => {
  const brush = gradient({GradientStops: [
    {Color: color(255), Offset: .5}, {Color: color(0, 255), Offset: .5}, {Color: color(0, 0, 255, 128), Offset: 1}
  ]});
  const svg = linearGradientSvg(brush, {width: 200, height: 80});
  assert.match(svg, /x1="50" y1="40" x2="150" y2="80"/);
  assert.match(svg, /gradientUnits="userSpaceOnUse"/);
  assert.match(svg, /spreadMethod="pad" color-interpolation="sRGB"/);
  assert(svg.indexOf('rgb(255,0,0)') < svg.indexOf('rgb(0,255,0)'));
  assert.match(svg, /stop-opacity="0\.25098039215686274"/);
  assert.deepEqual(brush.GradientStops.map(stop => stop.Offset), [.5, .5, 1]);
});

test('normalization accepts managed tagged points/stops, closed bounds, empty and one-stop brushes', () => {
  const normalized = normalizeLinearGradientBrush(gradient({
    StartPoint: {valueType: 'Windows.Foundation.Point', X: -100000, Y: 100000},
    GradientStops: [{valueType: media + 'GradientStop', Color: color(255), Offset: 0}]
  }));
  assert.equal(normalized.StartPoint.X, -100000);
  assert.match(linearGradientSvg(normalized, {width: 200, height: 80}), /fill="rgba\(255,0,0,0\.5\)"/);
  assert.match(linearGradientSvg(gradient({GradientStops: []}), {width: 0, height: 0}), /fill="transparent"/);
  assert.match(linearGradientSvg(gradient({EndPoint: {X: .25, Y: .5}}), {width: 200, height: 80}), /fill="rgba\(0,0,255,/);
  const stops = Array.from({length: 10000}, () => ({Color: color(1), Offset: 0}));
  assert.equal(normalizeLinearGradientBrush(gradient({GradientStops: stops})).GradientStops.length, 10000);
  assert.throws(() => normalizeLinearGradientBrush(gradient({GradientStops: [...stops, stops[0]]})), /10000/);
});

test('unknown modes, invalid channels/coordinates and malformed stop records produce explicit diagnostics', () => {
  for (const invalid of [
    gradient({MappingMode: 1}), gradient({SpreadMethod: 0}), gradient({ColorInterpolationMode: 0}),
    gradient({Opacity: 1.01}), gradient({StartPoint: {X: NaN, Y: 0}}), gradient({EndPoint: {X: 100001, Y: 0}}),
    gradient({Opacity: null}), gradient({StartPoint: null}), gradient({GradientStops: null}), gradient({GradientStops: new Array(2)}),
    gradient({GradientStops: [null]}), gradient({GradientStops: [{Color: color(1), Offset: -.01}]}),
    gradient({GradientStops: [{Color: color(1.5), Offset: 0}]}), gradient({GradientStops: [{Color: color(1), Offset: 0, Unknown: 1}]})
  ]) assert.throws(() => normalizeLinearGradientBrush(invalid), error => error.code === 'SFUI_GRADIENT');
  assert.throws(() => linearGradientSvg(gradient(), {width: Infinity, height: 80}), /finite range/);
});

test('host background, independent border and scalar foreground paint resize and clear through the actual host methods', () => {
  const scene = canvasScene(3);
  const node = scene.nodes[2];
  Object.assign(node.properties, {Background: gradient(), Foreground: gradient(), BorderBrush: gradient(),
    BorderThickness: {Left: 2, Top: 3, Right: 4, Bottom: 5}, CornerRadius: {TopLeft: 8, TopRight: 6, BottomRight: 4, BottomLeft: 2}});
  const fixture = geometryHost(scene);
  const element = fixture.host.elements.get(node.id);
  assert.equal(images(element).length, 3);
  assert.match(images(element)[0], /x1="35" y1="20" x2="105" y2="40"/);
  assert.match(images(element)[1], /fill-rule="evenodd"/);
  assert.equal(element.style.webkitTextFillColor, 'transparent');
  assert.equal(fixture.host.tryPatchProperties([{id: node.id, properties: {Width: 200, Height: 80}}]), true);
  fixture.host.flush();
  assert.match(images(element)[0], /x1="50" y1="40" x2="150" y2="80"/);
  fixture.host.apply(['Background', 'Foreground', 'BorderBrush'].map(property => ({op: 'set', id: node.id, property, value: null})));
  fixture.host.flush();
  assert.equal(element.style.backgroundImage, '');
  assert.equal(element.style.webkitTextFillColor, '');
  assert.equal(element.dataset.gradientPaint, undefined);
  fixture.host.dispose();
});

test('rectangle and ellipse gradient fill/stroke use bounded SVG geometry and unsupported surfaces fail explicitly', () => {
  for (const type of ['Rectangle', 'Ellipse']) {
    const scene = canvasScene(3);
    scene.nodes[2].type = 'Microsoft.UI.Xaml.Shapes.' + type;
    Object.assign(scene.nodes[2].properties, {Fill: gradient(), Stroke: gradient(), StrokeThickness: 4});
    const fixture = geometryHost(scene);
    const svg = images(fixture.host.elements.get('item2'))[0];
    assert.match(svg, type === 'Rectangle' ? /<rect x="2" y="2"/ : /<ellipse cx="70" cy="20"/);
    assert.match(svg, /stroke-width="4"/);
    fixture.host.dispose();
  }
  for (const [type, property] of [['Microsoft.UI.Xaml.Shapes.Line', 'Stroke'], ['Microsoft.UI.Xaml.Controls.TextBox', 'Foreground']]) {
    const scene = canvasScene(3);
    scene.nodes[2].type = type;
    scene.nodes[2].properties[property] = gradient();
    assert.throws(() => geometryHost(scene), error => error.code === 'SFUI_GRADIENT');
  }
});

test('JavaScript facade refreshes shared brush consumers on stop, collection and point replacement without losing identity', () => {
  const {app, media: api, Point, Color} = appFixture();
  const brush = new api.LinearGradientBrush();
  const first = new api.GradientStop();
  first.Color = Color.FromArgb(255, 255, 0, 0);
  const second = new api.GradientStop();
  second.Color = Color.FromArgb(255, 0, 0, 255);
  second.Offset = 1;
  brush.GradientStops.Add(first);
  brush.GradientStops.Add(second);
  const one = new app.Microsoft.UI.Xaml.Controls.Button();
  const two = new app.Microsoft.UI.Xaml.Controls.Button();
  one.Background = brush;
  two.Background = brush;
  const read = target => app.host.nodes.get(target.$node.id).properties.Background;
  const original = read(one);
  first.Color = Color.FromArgb(128, 0, 255, 0);
  assert.equal(read(one).GradientStops[0].Color.G, 255);
  assert.equal(read(two).GradientStops[0].Color.G, 255);
  assert.equal(original.GradientStops[0].Color.R, 255);
  assert.equal(one.Background, brush);
  brush.StartPoint = new Point(-.5, .25);
  brush.Opacity = .25;
  assert.deepEqual(read(one).StartPoint, {X: -.5, Y: .25});
  assert.equal(read(one).Opacity, .25);
  brush.GradientStops.RemoveAt(0);
  assert.equal(read(one).GradientStops.length, 1);
  const replacement = new api.GradientStopCollection();
  brush.GradientStops = replacement;
  assert.equal(read(one).GradientStops.length, 0);
  replacement.Insert(0, first);
  assert.equal(read(one).GradientStops[0].Color.G, 255);
  replacement.Clear();
  assert.equal(read(one).GradientStops.length, 0);
  app.dispose();
  assert.throws(() => { first.Offset = .5; }, /disposed/);
  assert.equal(first.Offset, 0);
});

test('JavaScript invalid mutations and cross-application brushes are atomic; Point remains immutable', () => {
  const a = appFixture();
  const b = appFixture();
  try {
    const brush = new a.media.LinearGradientBrush();
    const stop = new a.media.GradientStop();
    brush.GradientStops.Add(stop);
    for (const value of [null, new b.media.GradientStop(), brush]) {
      assert.throws(() => brush.GradientStops.Insert(0, value));
      assert.equal(brush.GradientStops.Count, 1);
    }
    assert.throws(() => { stop.Offset = 1.01; }, /finite range/);
    assert.equal(stop.Offset, 0);
    assert.throws(() => { brush.EndPoint = new a.Point(100001, 0); }, /finite range/);
    assert.throws(() => { brush.EndPoint = {X: 0, Y: 1}; }, /Point is required/);
    assert.equal(brush.EndPoint.X, 1);
    assert.throws(() => { stop.valueType = media + 'LinearGradientBrush'; }, TypeError);
    assert.throws(() => { brush.SpreadMethod = 2; }, TypeError);
    const point = new a.Point(1, 2);
    assert.throws(() => { point.X = 3; }, TypeError);
    const button = new a.app.Microsoft.UI.Xaml.Controls.Button();
    assert.throws(() => { button.Background = new b.media.LinearGradientBrush(); }, /this application/);
    assert.equal(button.Background, null);
    assert.throws(() => brush.GradientStops.RemoveAt(-1), /index/);
    assert.equal(brush.GradientStops.get_Item(0), stop);
  } finally { a.app.dispose(); b.app.dispose(); }
});

test('JavaScript stop collection accepts exactly 10000 entries and rejects the next mutation without changes', () => {
  const {app, media: api} = appFixture();
  try {
    const stops = new api.GradientStopCollection();
    const stop = new api.GradientStop();
    for (let index = 0; index < 10000; index++) stops.Add(stop);
    assert.equal(stops.Count, 10000);
    assert.throws(() => stops.Add(stop), /limit/);
    assert.throws(() => stops.Insert(5000, stop), /limit/);
    assert.equal(stops.Count, 10000);
    stops.RemoveAt(9999);
    stops.Insert(9999, stop);
    assert.equal(stops.Count, 10000);
  } finally { app.dispose(); }
});
