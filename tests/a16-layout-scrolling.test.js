import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollViewModel, ScrollViewerModel, nearestSnap, normalizeScrollOptions, sceneSnapPoints,
  registerScrollAnchor, computeWorldLayout } from '../packages/winui-controls/src/layout/index.js';
import { serializeRoutedEvent } from '../packages/winui-controls/src/input/transport.js';
import { element, panel, layoutFixture } from './helpers/a16-layout.js';

function frames() {
  const pending = new Map();
  let time = 0, sequence = 0;
  return { now: () => time, requestFrame: callback => { pending.set(++sequence, callback); return sequence; },
    cancelFrame: id => pending.delete(id), pending,
    advance(value) { time = value; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(time)); } };
}
function modelFixture(options = {}) {
  const clock = frames(), events = [];
  const model = new ScrollViewModel({ ...clock, ...options, onEvent: (name, args) => events.push({ name, args, offset: model.verticalOffset }) });
  model.setExtent({ width: 1000, height: 1000 }, { width: 200, height: 100 });
  return { model, clock, events };
}

test('scroll animations publish intermediate values and final ViewChanged before the matching completion', () => {
  const { model, clock, events } = modelFixture();
  const correlation = model.scrollTo(0, 200, { AnimationMode: 1 });
  assert.equal(correlation, 1);
  assert.equal(model.verticalOffset, 0);
  clock.advance(90);
  assert(model.verticalOffset > 0 && model.verticalOffset < 200);
  assert.equal(events.at(-1).args.IsIntermediate, true);
  clock.advance(180);
  assert.equal(model.verticalOffset, 200);
  assert.deepEqual(events.slice(-2).map(value => [value.name, value.args]), [
    ['ViewChanged', { IsIntermediate: false }], ['ScrollCompleted', { CorrelationId: correlation, Result: 'Completed' }]
  ]);
  assert.equal(clock.pending.size, 0);
});

test('replacement interrupts exactly once, supplied correlation IDs survive and disposal cancels remaining frames', () => {
  const { model, clock, events } = modelFixture();
  model.scrollTo(0, 300, { correlationId: 17 });
  clock.advance(30);
  assert.equal(model.scrollTo(0, 500, { correlationId: 42 }), 42);
  assert.deepEqual(events.filter(value => value.name === 'ScrollCompleted').map(value => value.args),
    [{ CorrelationId: 17, Result: 'Interrupted' }]);
  model.dispose();
  assert.equal(clock.pending.size, 0);
  assert.deepEqual(events.at(-1).args, { CorrelationId: 42, Result: 'Interrupted' });
  assert.throws(() => model.scrollTo(0, 1), /disposed/);
});

test('disabled/auto policies, no-op completion and zoom center preserve their distinct semantics', () => {
  const { model, clock, events } = modelFixture({ animationsEnabled: () => false });
  model.scrollTo(0, 200, { AnimationMode: 2 });
  assert.equal(model.verticalOffset, 200);
  assert.equal(clock.pending.size, 0);
  model.scrollTo(0, 200);
  assert.equal(events.at(-1).args.Result, 'Ignored');
  model.zoomTo(2, null, { AnimationMode: 0 });
  assert.equal(model.horizontalOffset, 50);
  assert.equal(model.verticalOffset, 225);
  assert.deepEqual(normalizeScrollOptions(), { animationMode: 2, snapPointsMode: 0 });
  assert.throws(() => normalizeScrollOptions({ AnimationMode: 10 }), /Invalid scrolling option/);
  assert.throws(() => model.scrollTo(Infinity, 1), /finite/);
  model.dispose();
});

test('snap points consume typed scene references, viewport alignment and large repeated ranges in constant space', () => {
  const nodes = new Map([['snap', { properties: { Value: 250, Alignment: 1 } }]]);
  const points = sceneSnapPoints({ properties: {}, collections: { VerticalSnapPoints: [{ $ref: 'snap' }] } },
    'VerticalSnapPoints', id => nodes.get(id), 100);
  assert.deepEqual(points, [200]);
  assert.equal(nearestSnap(49, [{ Offset: 0, Interval: 20, Start: 10, End: 1e9 }]), 40);
  assert.equal(nearestSnap(49, [0, 60]), 60);
  assert.throws(() => nearestSnap(0, [{ interval: 0 }]), /Invalid repeated/);
  assert.throws(() => sceneSnapPoints({ properties: {}, collections: { ZoomSnapPoints: new Array(2049).fill(1) } },
    'ZoomSnapPoints', () => null), /limit/);
});

test('extent shrink clamps in-flight samples and a completion callback can start the next operation', () => {
  const clock = frames(), completions = [];
  let started = false;
  const model = new ScrollViewModel({ ...clock, onEvent(name, args) {
    if (name !== 'ScrollCompleted') return;
    completions.push(args.CorrelationId);
    if (!started) { started = true; model.scrollTo(0, 50, { correlationId: 3, animationMode: 0 }); }
  } });
  model.setExtent({ width: 1000, height: 1000 }, { width: 100, height: 100 });
  model.scrollTo(0, 500, { correlationId: 1 });
  model.scrollTo(0, 300, { correlationId: 2 });
  assert.equal(model.verticalOffset, 50);
  assert.deepEqual(completions, [1, 3, 2]);
  model.scrollTo(0, 500);
  model.setExtent({ width: 200, height: 200 }, { width: 100, height: 100 });
  clock.advance(180);
  assert.equal(model.verticalOffset, 100);
  model.dispose();
});

test('registered and automatic scroll anchors preserve the same visible content after insertion above it', () => {
  const root = element('root', { Content: { $ref: 'content' }, VerticalOffset: 100, HorizontalScrollMode: 0 }, 'ScrollViewer');
  const fixture = layoutFixture([root, panel('content', 'StackPanel', ['first', 'anchor', 'last']),
    element('first', { Height: 100 }), element('anchor', { Height: 100, CanBeScrollAnchor: true }),
    element('last', { Height: 100 })], { width: 200, height: 100 });
  fixture.update();
  assert.equal(fixture.state('root').data.currentAnchor, 'anchor');
  fixture.nodes.get('first').properties.Height = 150;
  fixture.engine.invalidate('first');
  fixture.update();
  assert.equal(fixture.state('root').data.scroll.verticalOffset, 150);
  assert.equal(computeWorldLayout(fixture.engine).get('anchor').bounds.y, 0);
  const host = { layoutEngine: fixture.engine, nodes: fixture.nodes, invalidate: (id, kind) => fixture.engine.invalidate(id, kind) };
  assert.throws(() => registerScrollAnchor(host, 'root', 'root'), /descendant/);
  registerScrollAnchor(host, 'root', 'anchor');
  registerScrollAnchor(host, 'root', 'anchor', true);
  assert.equal(fixture.state('root').data.anchorCandidates.size, 0);
});

test('ParallaxView converges when its source is a later sibling and updates when that source scrolls', () => {
  const fixture = layoutFixture([panel('root', 'Grid', ['parallax', 'scroll']),
    element('parallax', { Child: { $ref: 'image' }, Source: { $ref: 'scroll' }, VerticalShift: 40 }, 'ParallaxView'),
    element('image', { Width: 100, Height: 100 }),
    element('scroll', { Content: { $ref: 'body' }, VerticalOffset: 100 }, 'ScrollViewer'),
    element('body', { Height: 500 })], { width: 200, height: 100 });
  fixture.update();
  assert.equal(fixture.state('parallax').data.childTransform[5], -10);
  fixture.nodes.get('scroll').properties.VerticalOffset = 200;
  fixture.engine.invalidate('scroll', 'arrange');
  fixture.update();
  assert.equal(fixture.state('parallax').data.childTransform[5], -20);
});

test('Expander separates header/content slots, suppresses collapsed layout and retains Up direction', () => {
  const fixture = layoutFixture([element('root', { Header: { $ref: 'header' }, Content: { $ref: 'body' }, IsExpanded: true }, 'Expander'),
    element('header', { IntrinsicWidth: 100, IntrinsicHeight: 24 }), element('body', { IntrinsicWidth: 80, IntrinsicHeight: 60 })],
  { width: 200, height: 100 });
  fixture.update();
  assert.equal(fixture.state('body').rect.y, 32);
  fixture.nodes.get('root').properties.ExpandDirection = 1;
  fixture.engine.invalidate('root'); fixture.update();
  assert.equal(fixture.state('header').rect.y, 68);
  assert.equal(fixture.state('body').rect.y, 0);
  fixture.nodes.get('root').properties.IsExpanded = false;
  fixture.engine.invalidate('root'); fixture.update();
  assert.equal(fixture.state('body').renderSize.height, 0);
  assert.equal(fixture.state('root').desiredSize.height, 32);
  assert.equal(fixture.nodes.get('body').properties.Visibility, undefined);
});
