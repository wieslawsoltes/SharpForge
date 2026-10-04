import test from 'node:test';
import assert from 'node:assert/strict';
import {LayoutEngine, createLayoutRegistry, computeWorldLayout, computeEffectiveViewports,
  LayoutLifecycle, rect} from '@sharpforge/winui-controls';
import {UIObjectTree} from '@sharpforge/winui-properties';

const element = (id, type, properties = {}, children = []) => ({id, type: 'Microsoft.UI.Xaml.Controls.' + type,
  properties, collections: {Children: children.map($ref => ({$ref}))}});

function scene() {
  const nodes = new Map([
    element('root', 'Canvas', {}, ['port']),
    element('port', 'ScrollViewer', {Width: 120, Height: 80, Content: {$ref: 'content'}}),
    element('content', 'Canvas', {Width: 500, Height: 500}, ['leaf']),
    element('leaf', 'Border', {Width: 40, Height: 100, $Left: 30, $Top: 60})
  ].map(node => [node.id, node]));
  const engine = new LayoutEngine({registry: createLayoutRegistry(), measureProvider: {measure: () => ({width: 0, height: 0})}});
  engine.synchronize(nodes, ['root']);
  engine.updateLayout({width: 200, height: 160});
  return {nodes, engine, world: () => computeWorldLayout(engine)};
}

test('viewport: registered clip applies to descendants and local Rect is not clamped to element size', () => {
  const fixture = scene(), values = computeEffectiveViewports(fixture.world());
  assert.deepEqual(values.get('port').EffectiveViewport, rect(0, 0, 200, 160));
  assert.deepEqual(values.get('leaf'), {EffectiveViewport: rect(-30, -60, 120, 80), MaxViewport: rect(-30, -60, 120, 80),
    BringIntoViewDistanceX: 0, BringIntoViewDistanceY: 60});
  fixture.nodes.get('content').properties.Clip = {Rect: {X: 90, Y: 100, Width: 1, Height: 1}};
  assert.deepEqual(computeEffectiveViewports(fixture.world()).get('leaf'), values.get('leaf'), 'ordinary Clip is irrelevant');
  fixture.nodes.get('port').properties.Clip = {Rect: {X: 0, Y: 0, Width: 1, Height: 1}};
  assert.deepEqual(computeEffectiveViewports(fixture.world()).get('leaf'), values.get('leaf'), 'port ordinary Clip stays separate');
  fixture.engine.dispose();
});

test('viewport: a rotated ancestor projects rectangles and bring distances through the scroll-port chain', () => {
  const fixture = scene();
  fixture.nodes.get('port').properties.RenderTransform = {type: 'Microsoft.UI.Xaml.Media.MatrixTransform',
    Matrix: {M11: 0, M12: 1, M21: -1, M22: 0, OffsetX: 120, OffsetY: 0}};
  const value = computeEffectiveViewports(fixture.world()).get('leaf');
  assert.deepEqual(value.EffectiveViewport, rect(-30, -60, 120, 80));
  assert.deepEqual(value.MaxViewport, rect(-30, -60, 120, 80));
  assert.equal(value.BringIntoViewDistanceX, 60);
  assert.equal(value.BringIntoViewDistanceY, 0);
  fixture.engine.dispose();
});

test('viewport: nested disjoint ports retain maximum preparation area and accumulate bring distances', () => {
  const fixture = scene();
  const outerContent = fixture.nodes.get('content');
  outerContent.collections.Children = [{$ref: 'inner'}];
  fixture.nodes.set('inner', element('inner', 'ScrollViewer', {Width: 70, Height: 50, $Left: 150, $Top: 180, Content: {$ref: 'leaf'}}));
  Object.assign(fixture.nodes.get('leaf').properties, {$Left: 0, $Top: 0});
  fixture.engine.synchronize(fixture.nodes, ['root']);
  fixture.engine.updateLayout({width: 200, height: 160});
  const value = computeEffectiveViewports(fixture.world()).get('leaf');
  assert.deepEqual(value.EffectiveViewport, rect());
  assert.deepEqual(value.MaxViewport, rect(0, 0, 70, 50));
  assert.equal(value.BringIntoViewDistanceX, 70);
  assert.equal(value.BringIntoViewDistanceY, 150);
  fixture.engine.dispose();
});

test('viewport: affine ancestor scale, translation, zoom and offsets use element-local coordinates', () => {
  const fixture = scene(), port = fixture.nodes.get('port');
  Object.assign(port.properties, {HorizontalOffset: 10, VerticalOffset: 20, ZoomFactor: 2});
  fixture.nodes.get('content').properties.RenderTransform = {type: 'Microsoft.UI.Xaml.Media.ScaleTransform', ScaleX: 2, ScaleY: 1};
  fixture.nodes.get('leaf').properties.RenderTransform = {type: 'Microsoft.UI.Xaml.Media.TranslateTransform', X: 5, Y: 7};
  fixture.engine.invalidate('port');
  fixture.engine.updateLayout({width: 200, height: 160});
  const value = computeEffectiveViewports(fixture.world()).get('leaf');
  assert.deepEqual(value.EffectiveViewport, rect(-30, -47, 30, 40));
  assert.deepEqual(value.MaxViewport, value.EffectiveViewport);
  assert.equal(value.BringIntoViewDistanceX, 120);
  assert.equal(value.BringIntoViewDistanceY, 94);
  fixture.engine.dispose();
});

test('viewport: singular transforms, visibility, malformed ancestry and node budgets are explicit', () => {
  const fixture = scene();
  fixture.nodes.get('content').properties.Visibility = 1;
  assert.equal(computeEffectiveViewports(fixture.world()).has('leaf'), false);
  fixture.nodes.get('content').properties.Visibility = 0;
  fixture.nodes.get('leaf').properties.RenderTransform = {type: 'Microsoft.UI.Xaml.Media.ScaleTransform', ScaleX: 0, ScaleY: 1};
  assert.deepEqual(computeEffectiveViewports(fixture.world()).get('leaf').EffectiveViewport, rect());
  const world = fixture.world();
  world.get('root').parentId = 'leaf';
  assert.throws(() => computeEffectiveViewports(world), {code: 'SFUI1678'});
  assert.throws(() => computeEffectiveViewports(fixture.world(), {maximumNodes: 2}), {code: 'SFUI1678'});
  assert.throws(() => computeEffectiveViewports(fixture.world(), {maximumDepth: Infinity}), {code: 'SFUI1678'});
  const invalid = fixture.world();
  invalid.get('leaf').renderSize.width = NaN;
  assert.throws(() => computeEffectiveViewports(invalid), {code: 'SFUI1678'});
  fixture.engine.dispose();
});

test('lifecycle: all sizes precede parent-first viewports and the final layout batch; queries and replay are silent', () => {
  const fixture = scene(), events = [];
  const tree = new UIObjectTree({onEvent: (id, event, payload) => events.push({id, event, payload})});
  for (const [id, state] of fixture.engine.states) { tree.register(id); tree.setVisualParent(id, state.parent); }
  tree.setConnected('root', true);
  events.length = 0;
  const lifecycle = new LayoutLifecycle(), revision = fixture.engine.version;
  lifecycle.publish(tree, fixture.world(), {revision, completed: true});
  const sizes = events.filter(value => value.event === 'SizeChanged');
  const viewports = events.filter(value => value.event === 'EffectiveViewportChanged');
  assert.equal(sizes.length, 4);
  assert.deepEqual(viewports.map(value => value.id), ['root', 'port', 'content', 'leaf']);
  assert.equal(events.findIndex(value => value.event === 'EffectiveViewportChanged'), sizes.length);
  assert.equal(events.findIndex(value => value.event === 'LayoutUpdated'), sizes.length + viewports.length);
  const count = events.length, snapshot = tree.snapshot();
  lifecycle.publish(tree, fixture.world(), {revision, completed: true});
  lifecycle.publish(tree, fixture.world(), {revision: revision + 1, completed: false});
  tree.restore(snapshot);
  assert.equal(events.length, count);
  lifecycle.publish(tree, fixture.world(), {revision: revision + 1, completed: true, suppress: true});
  assert.equal(events.length, count);
  tree.setConnected('root', false);
  events.length = 0;
  lifecycle.publish(tree, fixture.world(), {revision: revision + 2, completed: true});
  assert.deepEqual(events, []);
  tree.dispose(); fixture.engine.dispose();
});

test('tree viewport cache validates, clones and compares the complete public payload including MaxViewport', () => {
  const events = [], tree = new UIObjectTree({onEvent: (_id, event, payload) => {
    if (event === 'EffectiveViewportChanged') { events.push(structuredClone(payload)); payload.MaxViewport.width = 999; }
  }});
  tree.register('leaf'); tree.setConnected('leaf', true);
  const value = {EffectiveViewport: rect(-10, -20, 30, 40), MaxViewport: rect(-10, -20, 50, 60),
    BringIntoViewDistanceX: 2, BringIntoViewDistanceY: 3};
  tree.setEffectiveViewport('leaf', value);
  tree.setEffectiveViewport('leaf', value);
  assert.equal(events.length, 1);
  value.MaxViewport.width = 70;
  assert.equal(tree.require('leaf').viewport.MaxViewport.width, 50, 'caller and handler cannot mutate retained cache');
  tree.setEffectiveViewport('leaf', value);
  tree.setEffectiveViewport('leaf', {...value, BringIntoViewDistanceY: 4});
  assert.equal(events.length, 3);
  assert.throws(() => tree.setEffectiveViewport('leaf', {...value, MaxViewport: rect(0, 0, 1e10, 1)}), {code: 'SFTREE006'});
  assert.throws(() => tree.setEffectiveViewport('leaf', {...value, BringIntoViewDistanceX: NaN}), {code: 'SFTREE006'});
  const accessor = {...value};
  Object.defineProperty(accessor, 'MaxViewport', {get() { assert.fail('viewport accessors cannot execute'); }});
  assert.throws(() => tree.setEffectiveViewport('leaf', accessor), {code: 'SFTREE006'});
  const snapshot = tree.snapshot();
  snapshot.nodes[0].viewport.MaxViewport.width = 12;
  assert.equal(tree.require('leaf').viewport.MaxViewport.width, 70);
  tree.dispose();
});

test('lifecycle: a newly observed element receives its first viewport on the next completed arrange', () => {
  const fixture = scene(), events = [], observed = new Set();
  const tree = new UIObjectTree({onEvent: (id, event) => { if (event === 'EffectiveViewportChanged') events.push(id); }});
  for (const [id, state] of fixture.engine.states) { tree.register(id); tree.setVisualParent(id, state.parent); }
  tree.setConnected('root', true);
  const lifecycle = new LayoutLifecycle(), options = {completed: true, observesViewport: id => observed.has(id)};
  lifecycle.publish(tree, fixture.world(), {...options, revision: fixture.engine.version});
  assert.deepEqual(events, []);
  observed.add('leaf');
  fixture.engine.invalidate('leaf', 'arrange');
  fixture.engine.updateLayout({width: 200, height: 160});
  lifecycle.publish(tree, fixture.world(), {...options, revision: fixture.engine.version});
  assert.deepEqual(events, ['leaf']);
  tree.dispose(); fixture.engine.dispose();
});
