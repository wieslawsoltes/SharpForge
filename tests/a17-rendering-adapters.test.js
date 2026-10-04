import test from 'node:test';
import assert from 'node:assert/strict';
import {registerRenderingAdapters, initializeRenderingBase, materializeRenderingModelDefaults,
  createCanvasDrawEvent} from '../packages/rendering/src/contracts/adapters.js';
import {DrawingModel, DrawingCollection, serializeRenderingValue} from '../packages/rendering/src/media/models.js';
import {materializeRenderingResource} from '../packages/rendering/src/media/materializer.js';
import {createRenderingBrushConnections} from '../packages/rendering/src/brushes/connections.js';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {normalizeBrush} from '../packages/rendering/src/brushes/brushes.js';
import {createModelContext} from './fixtures/rendering/model-context.js';

const M = 'Microsoft.UI.Xaml.Media.', F = 'Windows.Foundation.';
function createAdapters() {
  const adapters = new Map();
  registerRenderingAdapters({register(contract, handler) { adapters.set(`${contract.owner}:${contract.name}`, handler); }});
  const context = createModelContext();
  return {context, call(owner, name, receiver = null, args = [], result = 'object') {
    const handler = adapters.get(`${owner}:${name}`);
    assert.ok(handler, `${owner}.${name} has an adapter`);
    return handler({context, receiver, args, descriptor: {owner, name, result}});
  }};
}

test('typed model defaults retain Point identity at Default precedence and custom subclass setters use the property store', () => {
  const {context, call} = createAdapters();
  const segment = call(M + 'LineSegment', '.ctor');
  materializeRenderingModelDefaults(context, segment, (name, value) => context.seed(segment, name, value));
  const point = context.read(segment, 'Point');
  assert.equal(point.type, F + 'Point');
  assert.deepEqual(context.unwrapModel(point).data, {X: 0, Y: 0});
  assert.equal(call(M + 'LineSegment', 'get_Point', segment, [], F + 'Point'), point);
  assert.equal(context.values.get(segment).size, 0);
  const custom = {type: 'CustomBrush'};
  const model = initializeRenderingBase(context, custom, M + 'XamlCompositionBrushBase');
  assert.equal(context.unwrapModel(custom), model);
  assert.equal(model.renderType, M + 'XamlCompositionBrushBase');
  const brush = {type: 'Microsoft.UI.Composition.CompositionBrush', data: {kind: 'solid', color: 'red'}};
  call(M + 'XamlCompositionBrushBase', 'set_CompositionBrush', custom, [brush]);
  assert.equal(context.read(custom, 'CompositionBrush'), brush);
  assert.deepEqual(model.get('CompositionBrush'), brush.data);
  assert.equal(initializeRenderingBase(context, custom, 'CustomBrush'), null);
});

test('CLR drawing structs serialize as flat typed values while scene objects retain their property descriptors', () => {
  for (const [type, data] of [[F + 'Point', {X: 3, Y: 4}], [F + 'Size', {Width: 8, Height: 9}],
    [F + 'Rect', {X: 1, Y: 2, Width: 8, Height: 9}],
    [M + 'Matrix', {M11: 1, M12: 0, M21: 0, M22: 1, OffsetX: 2, OffsetY: 3}]]) {
    assert.deepEqual(serializeRenderingValue(new DrawingModel(type, data)), {...data, valueType: type});
  }
  const point = new DrawingModel(F + 'Point', {X: 3, Y: 4});
  const geometry = serializeRenderingValue(new DrawingModel(M + 'LineSegment', {Point: point}));
  assert.equal(geometry.type, M + 'LineSegment');
  assert.deepEqual(geometry.properties.Point, {valueType: F + 'Point', X: 3, Y: 4});
  assert.equal(geometry.Point, geometry.properties.Point);
});

test('native struct wrappers initialize CLR fields and adapters accept values materialized by the property store', () => {
  const {context, call} = createAdapters();
  const point = call(F + 'Point', '.ctor', null, [3, 4]);
  materializeRenderingModelDefaults(context, point, () => assert.fail('Value types do not seed dependency-property defaults'));
  assert.equal(context.read(point, 'X'), 3); assert.equal(context.read(point, 'Y'), 4);
  const stored = context.allocate(F + 'Point');
  context.seed(stored, 'X', 5); context.seed(stored, 'Y', 6);
  assert.equal(call(F + 'Point', 'get_X', stored), 5);
  call(F + 'Point', 'set_Y', stored, [7]);
  assert.equal(call(F + 'Point', 'get_Y', stored), 7);
  const matrix = context.allocate(M + 'Matrix');
  for (const [field, value] of Object.entries({M11: 2, M12: 0, M21: 0, M22: 3, OffsetX: 4, OffsetY: 5})) context.seed(matrix, field, value);
  assert.equal(call(M + 'Matrix', 'get_OffsetX', matrix), 4);
  call(M + 'Matrix', 'set_OffsetX', matrix, [8]);
  assert.equal(context.read(matrix, 'OffsetX'), 8);
  assert.equal(call(M + 'Matrix', 'get_M22', matrix), 3);
});

test('Color constructors, collection wrappers, byref transforms and resource descriptors preserve exact typed values', () => {
  const {context, call} = createAdapters();
  const color = context.allocate('Windows.UI.Color', {A: 255, R: 255, G: 0, B: 0});
  const brush = call(M + 'SolidColorBrush', '.ctor', null, [color]);
  assert.equal(context.read(brush, 'Color'), color);
  const collection = call(M + 'PointCollection', '.ctor');
  const point = call(F + 'Point', '.ctor', null, [2, 3]);
  call(M + 'PointCollection', 'Add', collection, [point]);
  assert.equal(call(M + 'PointCollection', 'get_Item', collection, [0], F + 'Point'), point);
  assert.equal(call(M + 'PointCollection', 'get_Count', collection), 1);
  assert.throws(() => call(M + 'PointCollection', 'get_Item', collection, [1]), RangeError);
  const transform = context.wrapModel(new DrawingModel(M + 'TranslateTransform', {X: 5, Y: -1}), M + 'TranslateTransform');
  const output = {value: null};
  assert.equal(call(M + 'Transform', 'TryTransform', transform, [point, output]), true);
  assert.equal(output.value.type, F + 'Point');
  assert.deepEqual(context.unwrapModel(output.value).data, {X: 7, Y: 2});
  const singular = context.wrapModel(new DrawingModel(M + 'ScaleTransform', {ScaleX: 0, ScaleY: 1}), M + 'ScaleTransform');
  assert.equal(call(M + 'Transform', 'get_Inverse', singular), null);
  const descriptor = {kind: 'SolidColorBrush', color: '#ff804020', opacity: 0.5};
  const first = materializeRenderingResource(context, descriptor, M + 'Brush');
  assert.equal(materializeRenderingResource(context, descriptor, M + 'Brush'), first);
  assert.deepEqual(context.unwrapModel(first).get('Color'), {A: 255, R: 128, G: 64, B: 32});
  assert.equal(context.unwrapModel(first).get('Opacity'), 0.5);
});

test('shared custom brush lifetimes invoke once, restoration is silent, and collected owners do not dereference stale wrappers', () => {
  const context = createModelContext(), connections = createRenderingBrushConnections(context);
  const brush = {type: 'CustomBrush'}, model = initializeRenderingBase(context, brush, M + 'XamlCompositionBrushBase');
  context.modelReferences.set(model, brush);
  const first = {type: 'Visual'}, second = {type: 'Visual'};
  context.write(first, 'Background', brush); context.write(second, 'Background', brush);
  connections.attach(first); connections.attach(second);
  assert.deepEqual(context.calls.map(call => call.name), ['OnConnected()']);
  const lease = connections.lease(first), saved = lease.snapshot();
  connections.detach(first);
  lease.restore(saved);
  assert.equal(context.calls.length, 1);
  connections.detach(first); connections.detach(second);
  assert.deepEqual(context.calls.map(call => call.name), ['OnConnected()', 'OnDisconnected()']);
  connections.attach(first);
  assert.equal(context.calls.at(-1).name, 'OnConnected()');
  context.unwrapModel = () => { throw new Error('Collected references cannot be dereferenced'); };
  lease.dispose({preserveValues: true, collected: true});
  lease.restore(saved);
  lease.dispose({preserveValues: true, restoring: true});
  assert.equal(context.calls.length, 3);
  assert.deepEqual(lease.retainedValues(), []);
});

test('XamlCompositionBrushBase serializes native gradients through descriptors without compositor cycles', async () => {
  const compositor = new Compositor(), gradient = compositor.CreateLinearGradientBrush();
  gradient.ColorStops.Add(compositor.CreateColorGradientStop(0, [1, 0, 0, 1]));
  gradient.ColorStops.Add(compositor.CreateColorGradientStop(1, [0, 0, 1, 1]));
  const model = new DrawingModel(M + 'XamlCompositionBrushBase', {CompositionBrush: gradient});
  const serialized = serializeRenderingValue(model), normalized = normalizeBrush(serialized);
  assert.equal(serialized.CompositionBrush.kind, 'CompositionLinearGradientBrush');
  assert.equal(serialized.CompositionBrush.Compositor, undefined);
  assert.equal(normalized.kind, 'linear');
  assert.deepEqual(normalized.stops.map(stop => stop.color), [[1, 0, 0, 1], [0, 0, 1, 1]]);
  await compositor.dispose();
});

test('Canvas drawing sessions increment per owner, seal once, restore versions and remain rooted through event arguments', () => {
  const {context, call} = createAdapters(), receiver = {id: 'canvas:7', type: 'CanvasControl'};
  const first = createCanvasDrawEvent(context, receiver);
  const sessionType = 'Microsoft.Graphics.Canvas.CanvasDrawingSession';
  const session = call('Microsoft.Graphics.Canvas.UI.Xaml.CanvasDrawEventArgs', 'get_DrawingSession', first.args);
  assert.equal(context.unwrapModel(session), first.drawing);
  first.drawing.DrawRectangle([0, 0, 10, 10], 'red');
  const open = first.drawing.snapshot();
  first.drawing.DrawLine([0, 0], [1, 1], {width: 1, brush: 'blue'});
  first.drawing.restore(open);
  assert.equal(first.drawing.commands.length, 1);
  assert.ok(context.unwrapModel(first.args).retainedValues().includes(first.drawing));
  const list = first.complete();
  const sealed = first.drawing.snapshot(); first.dispose(); first.drawing.restore(sealed);
  assert.equal(list.elementId, 'canvas:7'); assert.equal(list.version, 1);
  assert.throws(() => call(sessionType, 'Clear', session, ['red']), error => error.code === 'SFRENDER007');
  assert.throws(() => first.complete(), error => error.code === 'SFRENDER007');
  const version = context.state(receiver, 'canvasDrawVersion'), saved = version.snapshot();
  const second = createCanvasDrawEvent(context, receiver);
  assert.equal(second.complete().version, 2); version.restore(saved);
  assert.equal(createCanvasDrawEvent(context, receiver).complete().version, 2);
  const collection = new DrawingCollection(M + 'GeometryCollection', [new DrawingModel(M + 'RectangleGeometry')]);
  const before = collection.snapshot(); collection.removeAt(0); collection.restore(before);
  assert.equal(collection.retainedValues().length, 1);
});
