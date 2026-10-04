import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererRegistry } from '../packages/winui-controls/src/registry.js';
import { size, rect, measureElement, arrangeElement, viewboxScale, customLayout } from '../packages/winui-controls/src/layout/index.js';
import { element, panel, layoutFixture } from './helpers/a16-layout.js';

test('renderer registrations are isolated, explicit, and inherited', () => {
  const registry = new RendererRegistry({ resolveType: type => type === 'Custom' ? { base: 'Base' } : null });
  const renderer = { render() {} };
  registry.register('Base', renderer);
  assert.equal(registry.resolve('Custom').render, renderer.render);
  assert.throws(() => registry.register('Base', {}), /already registered/);
  const other = registry.clone();
  other.register('Base', { custom: true }, { override: true });
  assert.equal(other.resolve('Custom').custom, true);
  assert.equal(registry.resolve('Custom').custom, undefined);
});

test('FrameworkElement margins, constraints and alignment share deterministic slots', () => {
  const properties = { Width: 20, Height: 10, Margin: { Left: 5, Right: 5, Top: 3, Bottom: 3 },
    HorizontalAlignment: 1, VerticalAlignment: 2 };
  const measured = measureElement(properties, size(100, 100), () => size(500, 500));
  assert.deepEqual(measured.desired, size(30, 16));
  assert.deepEqual(arrangeElement(properties, rect(0, 0, 100, 100), measured.unclipped), rect(40, 87, 20, 10));
  assert.throws(() => size(NaN, 1));
  assert.throws(() => size(undefined, 1));
  assert.throws(() => size(1, undefined));
  assert.deepEqual(size(), { width: 0, height: 0 });
  assert.deepEqual(size(1), { width: 1, height: 0 });
  assert.throws(() => rect(0, 0, Infinity, 1));
  assert.throws(() => measureElement({}, size(1, 1), () => size(Infinity, 1)), /finite desired/);
});

test('vertical StackPanel uses horizontal alignment on the cross axis, preserving shapes in flow', () => {
  const fixture = layoutFixture([panel('root', 'StackPanel', ['first', 'second'], { Spacing: 5 }),
    element('first', { Width: 20, Height: 10, HorizontalAlignment: 1 }, 'Rectangle'),
    element('second', { Width: 30, Height: 20, HorizontalAlignment: 2 })], { width: 100, height: 100 });
  fixture.update();
  assert.deepEqual(fixture.state('first').rect, rect(40, 0, 20, 10));
  assert.deepEqual(fixture.state('second').rect, rect(70, 15, 30, 20));
  const version = fixture.engine.version;
  fixture.update();
  assert.equal(fixture.engine.stats.measures, 0);
  assert.equal(fixture.engine.stats.arranges, 0);
  assert.equal(fixture.engine.version, version);
  fixture.nodes.get('first').properties.Height = 15;
  fixture.engine.invalidate('first');
  fixture.update();
  assert.equal(fixture.state('second').rect.y, 20);
});

test('Canvas ignores child desired size, preserves offsets and permits content outside its bounds', () => {
  const fixture = layoutFixture([panel('root', 'Canvas', ['shape']), element('shape', { Width: 20, Height: 10, Left: -5, Top: 240 })]);
  fixture.update();
  assert.deepEqual(fixture.state('root').desiredSize, size());
  assert.deepEqual(fixture.state('shape').rect, rect(-5, 240, 20, 10));
  assert.equal(fixture.state('root').data.clip, undefined);
});

test('layout rejects visual cycles, duplicate parents, reentry, disposed use, and cancellation', () => {
  assert.throws(() => layoutFixture([panel('root', 'Panel', ['child']), panel('child', 'Panel', ['root'])]), /cycle/);
  assert.throws(() => layoutFixture([panel('root', 'Panel', ['a', 'b']), panel('a', 'Panel', ['child']),
    panel('b', 'Panel', ['child']), element('child')]), /multiple layout parents/);
  const fixture = layoutFixture([element('root')]);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => fixture.engine.updateLayout(fixture.viewport, { signal: controller.signal }), { name: 'AbortError' });
  const algorithm = customLayout({ measureOverride: (context, available) => context.measure(context.id, available), arrangeOverride() {} });
  fixture.engine.registry.register('Control', algorithm);
  assert.throws(() => fixture.update(), /Reentrant/);
  fixture.engine.dispose();
  assert.throws(() => fixture.update(), /disposed/);
});

test('Viewbox covers all stretch and direction combinations without affecting child natural measure', () => {
  const desired = size(100, 50);
  const available = size(50, 100);
  assert.deepEqual(viewboxScale(desired, available, 0), { x: 1, y: 1 });
  assert.deepEqual(viewboxScale(desired, available, 1), { x: 0.5, y: 2 });
  assert.deepEqual(viewboxScale(desired, available, 2), { x: 0.5, y: 0.5 });
  assert.deepEqual(viewboxScale(desired, available, 3), { x: 2, y: 2 });
  assert.deepEqual(viewboxScale(desired, available, 2, 1), { x: 1, y: 1 });
  assert.deepEqual(viewboxScale(desired, available, 3, 2), { x: 1, y: 1 });
});
