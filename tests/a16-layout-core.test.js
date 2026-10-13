import test from 'node:test';
import assert from 'node:assert/strict';
import { RendererRegistry } from '../packages/winui-controls/src/registry.js';
import { size, rect, measureElement, arrangeElement, viewboxScale } from '../packages/winui-controls/src/layout/index.js';

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
  assert.throws(() => rect(0, 0, Infinity, 1));
  assert.throws(() => measureElement({}, size(1, 1), () => size(Infinity, 1)), /finite desired/);
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
