import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';
import {DrawOp} from '../packages/rendering/src/drawing/commands.js';
import {createControlRenderers, scrollLayer} from '../packages/rendering/src/controls/delegates.js';
import {RetainedPlacement} from '../packages/rendering/src/controls/placement.js';
import {shapeGeometry, shapePen} from '../packages/rendering/src/controls/shape-renderer.js';
import {createRenderingMeasureProvider} from '../packages/rendering/src/controls/measure-provider.js';
import {applyDisplayListCommand, acquireSwapChainPanel} from '../packages/rendering/src/controls/canvas-control.js';
import {captureVisualDisplayList} from '../packages/rendering/src/controls/capture.js';
import {ResourceTable} from '../packages/rendering/src/resources/resource-table.js';
import {fillContains} from '../packages/rendering/src/geometry/geometry-math.js';

const registry = createControlRenderers();
const layout = {rect: {width: 100, height: 60}, bounds: [0, 0, 100, 60]};
const node = (type, properties = {}) => ({id: 'subject', type: `Microsoft.UI.Xaml.Controls.${type}`, properties});

test('SF-A17-B01/B02: stroke-only shape delegates preserve transparent interiors and elliptical corner radii in every parent', () => {
  for (const parent of ['Canvas', 'Grid', 'StackPanel']) {
    const rectangle = node('Rectangle', {Fill: null, Stroke: 'red', StrokeThickness: 4, RadiusX: 18, RadiusY: 6});
    rectangle.parent = parent;
    const list = registry.encode(rectangle, layout);
    assert.equal(list.commands[0].brush, null);
    assert.equal(list.commands[0].pen.width, 4);
    assert.deepEqual(list.commands[0].rect, [2, 2, 96, 56]);
    assert.deepEqual(list.commands[0].radii, [18, 6, 18, 6, 18, 6, 18, 6]);
    const ellipse = registry.encode({...rectangle, type: 'Microsoft.UI.Xaml.Shapes.Ellipse'}, layout);
    assert.equal(ellipse.commands[0].op, DrawOp.Ellipse);
    assert.equal(ellipse.commands[0].brush, null);
  }
});

test('line, polygon and native Path geometry use the same parent-independent delegate and stroke contract', () => {
  const properties = {X1: 1, Y1: 2, X2: 20, Y2: 30, Stroke: 'black', StrokeThickness: 0.5,
    StrokeDashArray: [2, 3], StrokeStartLineCap: 2, StrokeEndLineCap: 1, StrokeLineJoin: 2, StrokeDashOffset: 0.25};
  const line = registry.encode(node('Line', properties), layout);
  const command = line.commands.find(value => value.op === DrawOp.Geometry);
  assert.deepEqual(command.geometry.figures[0].start, [1, 2]);
  assert.equal(command.brush, null);
  assert.deepEqual(shapePen(properties), {brush: 'black', width: 0.5, dash: [2, 3], dashOffset: 0.25,
    dashCap: 'butt', startCap: 'round', endCap: 'square', join: 'round', miterLimit: 10});
  const polygon = node('Polygon', {Points: '0,0 30,0 30,30 0,30', FillRule: 0});
  assert.equal(fillContains(shapeGeometry(polygon, layout), [15, 15]), true);
  assert.equal(shapeGeometry({...polygon, type: 'Polyline'}, layout).figures[0].closed, false);
  assert.throws(() => shapeGeometry(node('Polygon', {Points: '1,2,3'}), layout), error => error.code === 'SFRENDER110');
  const path = shapeGeometry(node('Path', {Data: {type: 'RectangleGeometry', Rect: {X: 2, Y: 3, Width: 10, Height: 20}}}), layout);
  assert.equal(fillContains(path, [5, 8]), true);
});

test('nonuniform border rings and dual focus rings retain their hollow geometry and background sizing', () => {
  const border = node('Border', {Background: 'blue', BorderBrush: 'red', BorderThickness: {Left: 2, Top: 4, Right: 6, Bottom: 8},
    CornerRadius: {TopLeft: 12, TopRight: 10, BottomLeft: 6, BottomRight: 8}});
  const list = registry.encode(border, layout);
  assert.deepEqual(list.commands[0].rect, [2, 4, 92, 48]);
  assert.equal(list.commands[1].geometry.fillRule, 'evenodd');
  assert.equal(fillContains(list.commands[1].geometry, [50, 30]), false);
  assert.equal(fillContains(list.commands[1].geometry, [50, 2]), true);
  border.properties.BackgroundSizing = 1;
  assert.deepEqual(registry.encode(border, layout).commands[0].rect, [0, 0, 100, 60]);
  const focused = registry.encode({...node('Button', {FocusState: 1, FocusVisualMargin: -2}), templateRoot: 'template'}, layout);
  assert.equal(focused.commands.length, 2);
  assert.ok(focused.commands.every(value => value.op === DrawOp.Geometry && !fillContains(value.geometry, [50, 30])));
});

test('text measurement and painting share text scaling, wrapping, spans and character-spacing options', () => {
  const calls = [], run = {width: 60, height: 40, lines: [], clusters: []};
  const service = {layout(text, options) { calls.push({text, options}); return run; }, clear() { calls.push('clear'); }};
  const fallback = {measure: () => ({width: 3, height: 4}), invalidate() {}, dispose() { this.disposed = true; }};
  const provider = createRenderingMeasureProvider({fallback, textService: service, textScale: () => 1.5});
  const text = node('TextBlock', {Text: 'office العربية', FontFamily: 'sans-serif', FontFamilyObject: {Source: 'serif'},
    FontSize: 20, CharacterSpacing: 100,
    TextWrapping: 1, TextAlignment: 1, LineHeight: 24, MaxLines: 2, TextTrimming: 2});
  assert.deepEqual(provider.measure(text, {width: 100, height: Infinity}), {width: 60, height: 40});
  const result = registry.encode(text, layout, null, {textService: service, textScale: 1.5});
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].options.fontSize, 30);
  assert.equal(calls[0].options.fontFamily, 'serif');
  assert.equal(calls[0].options.runs[0].style.fontFamily, 'serif');
  assert.equal(calls[0].options.letterSpacing, 3);
  assert.equal(calls[0].options.lineHeight, 36);
  assert.equal(result.commands[0].op, DrawOp.GlyphRun);
  assert.deepEqual(provider.measure(node('Button'), {}), {width: 3, height: 4});
  provider.invalidate(); provider.dispose();
  assert.equal(calls.at(-1), 'clear'); assert.equal(fallback.disposed, true);
  assert.throws(() => registry.encode(text, layout), error => error.code === 'SFRENDER085');
});

test('ancestor scroll clips update placement without copying or re-encoding retained item contents', () => {
  const resources = new ResourceTable({session: 'placement'});
  const content = new DrawingContext({elementId: 'item', version: 1}).DrawRectangle([0, 0, 20, 20], 'red').finish();
  const placement = new RetainedPlacement('item', resources);
  const viewport = {rect: {x: 0, y: 0, width: 100, height: 60}, transform: [1, 0, 0, 1, 50, 30]};
  const first = placement.update(content, {clips: [viewport], worldTransform: [1, 0, 0, 1, 60, 35]});
  assert.deepEqual(first.commands[1].geometry.transform, [1, 0, 0, 1, -10, -5]);
  assert.equal(resources.resolve(placement.handle).displayList, content);
  const resourceVersion = resources.getVersion(placement.handle);
  const second = placement.update(content, {clips: [viewport], worldTransform: [1, 0, 0, 1, 60, 15]});
  assert.notEqual(first, second);
  assert.deepEqual(second.commands[1].geometry.transform, [1, 0, 0, 1, -10, 15]);
  assert.equal(resources.getVersion(placement.handle), resourceVersion);
  assert.deepEqual(first.commands[2].layer, second.commands[2].layer);
  const changed = new DrawingContext({elementId: 'item', version: 2}).DrawRectangle([0, 0, 20, 20], 'blue').finish();
  assert.equal(placement.update(changed, {clips: [viewport], worldTransform: [1, 0, 0, 1, 60, 15]}), second);
  assert.equal(resources.resolve(placement.handle).displayList, changed);
  assert.equal(placement.update(changed, {clips: []}), changed);
  assert.throws(() => placement.update(content, {clips: Array(129).fill(viewport)}), error => error.code === 'SFRENDER139');
  assert.equal(scrollLayer(content, [0, 0, 100, 60], {offsetY: 40}).displayList.commands[0].op, DrawOp.PushClip);
  placement.dispose(); placement.dispose();
  assert.equal(resources.liveCount, 0); resources.dispose();
});

test('Canvas Draw packets are validated for the attached element and SwapChainPanel releases only its own canvas', () => {
  const drawing = new DrawingContext({elementId: 'subject', version: 2}).DrawLine([0, 0], [20, 20], {brush: 'red'}).finish();
  const subject = node('CanvasControl'), invalidations = [];
  const context = {invalidate: (...args) => invalidations.push(args)};
  applyDisplayListCommand(context, {displayList: drawing.serialize()}, subject);
  assert.equal(subject.drawingList.version, 2);
  assert.deepEqual(invalidations, [['subject', 'render']]);
  assert.throws(() => applyDisplayListCommand(context, {displayList: drawing}, {...subject, id: 'other'}), error => error.code === 'SFRENDER138');
  assert.throws(() => applyDisplayListCommand(context, {displayList: drawing}, null), error => error.code === 'SFRENDER137');
  const state = {}, element = {prepend() {}}, device = {};
  const host = {nodes: new Map([['subject', node('SwapChainPanel')]]), elements: new Map([['subject', element]]),
    context: {getState: () => state}, services: {device}, getLayout: () => ({renderSize: {width: 20, height: 10}}),
    document: {defaultView: {devicePixelRatio: 1.5}, createElement: () => ({style: {}, setAttribute() {}, remove() {}})}};
  const lease = acquireSwapChainPanel(host, 'subject');
  assert.equal(lease.canvas.width, 30); assert.equal(lease.canvas.height, 15); assert.equal(lease.deviceService, device);
  lease.release(); lease.release();
  const replacement = acquireSwapChainPanel(host, 'subject');
  lease.release(); assert.equal(state.swapChainCanvas, replacement.canvas); replacement.release();
});

test('bitmap capture preserves tree geometry and cross-session composition resources and rejects native input without a capture service', () => {
  const resources = new ResourceTable({session: 'capture-child'}), brush = resources.register('brush', 'red');
  const list = new DrawingContext().DrawRectangle([0, 0, 10, 10], brush).finish();
  const nodes = new Map([['root', {...node('Grid'), id: 'root'}], ['child', {...node('Button'), id: 'child'}]]);
  const layouts = new Map([['root', {version: 1, worldTransform: [1, 0, 0, 1, 10, 20],
    renderSize: {width: 100, height: 60}, children: ['child'], clip: {x: 0, y: 0, width: 100, height: 60}}],
  ['child', {worldTransform: [1, 0, 0, 1, 30, 40], renderSize: {width: 10, height: 10}, children: []}]]);
  const host = {nodes, getLayout: id => layouts.get(id), elements: new Map(), services: {}};
  const captured = captureVisualDisplayList(host, new Map(), 'root', new Map([['child', {list, resources}]]));
  assert.equal(captured.width, 100); assert.equal(captured.height, 60);
  assert.deepEqual(captured.list.commands[2].transform, [1, 0, 0, 1, 20, 20]);
  assert.equal(captured.list.commands[3].layer.displayList.commands[0].brush, 'red');
  host.elements.set('child', {tagName: 'INPUT'});
  assert.throws(() => captureVisualDisplayList(host, new Map(), 'root'), error => error.code === 'SFRENDER134');
  resources.dispose();
});
