import test from 'node:test';
import assert from 'node:assert/strict';
import { HostComposition } from '../packages/winui-controls/src/host/composition.js';
import { computeWorldLayout, renderTransform, elementClip } from '../packages/winui-controls/src/layout/index.js';
import { layoutFixture, panel, element } from './helpers/a16-layout.js';

test('composition values change cached world geometry without changing base properties or measure counts', () => {
  const fixture = layoutFixture([panel('root', 'Canvas', ['child']), element('child', { Width: 20, Height: 10, Left: 4, Top: 3 })]);
  fixture.update();
  let scheduled = 0;
  const composition = new HostComposition({ nodes: fixture.nodes, options: {}, scheduleRender: () => scheduled++ });
  const previousMeasures = fixture.engine.stats.measures;
  composition.set('child', '$Left', 40);
  composition.set('child', 'Opacity', 0.25);
  const layout = computeWorldLayout(fixture.engine, { resolveNode: id => composition.resolve(id), composition });
  assert.equal(layout.get('child').bounds.x, 40);
  assert.equal(fixture.nodes.get('child').properties.Left, 4);
  assert.equal(fixture.nodes.get('child').properties.Opacity, undefined);
  assert.equal(composition.resolve('child').properties.Opacity, 0.25);
  assert.equal(fixture.engine.stats.measures, previousMeasures);
  assert.equal(scheduled, 2);
  composition.set('child', '$Left', undefined);
  assert.equal(computeWorldLayout(fixture.engine, { composition }).get('child').bounds.x, 4);
  assert.throws(() => composition.set('child', 'Opacity', NaN), /finite/);
  assert.equal(composition.set('child', 'Width', 50), false);
});

test('typed TransformGroup descriptors compose in declared order and preserve rectangle clips', () => {
  const transform = { valueType: 'Microsoft.UI.Xaml.Media.TransformGroup', properties: { Children: [
    { valueType: 'Microsoft.UI.Xaml.Media.ScaleTransform', ScaleX: 2, ScaleY: 3 },
    { type: 'TranslateTransform', properties: { X: 5, Y: 7 } }
  ] } };
  assert.deepEqual(renderTransform({ RenderTransform: transform }, { width: 10, height: 10 }), [2, 0, 0, 3, 5, 7]);
  assert.deepEqual(elementClip({ Clip: { valueType: 'RectangleGeometry', properties: { Rect: { X: 2, Y: 3, Width: 8, Height: 9 } } } }),
    { x: 2, y: 3, width: 8, height: 9 });
  const group = { type: 'TransformGroup', properties: { Children: [] } };
  group.properties.Children.push(group);
  assert.throws(() => renderTransform({ RenderTransform: group }, { width: 1, height: 1 }), /cycle/);
});

test('element preview opacity overrides the UI value and child surfaces receive their resource table', () => {
  const resources = {};
  const calls = [];
  const host = { nodes: new Map([['element', { id: 'element', properties: { Opacity: 0.4 } }]]),
    context: {}, options: { renderComposition: (...args) => calls.push(args) }, scheduleRender() {} };
  const composition = new HostComposition(host);
  const visual = { Opacity: 0.2, matrix: () => [1, 0, 0, 1, 0, 0] };
  const child = { Compositor: { resources, layerFor: () => ({ id: 'child-layer' }) } };
  composition.setElement('element', { visual, child });
  const target = { style: {} };
  composition.paint('element', target);
  assert.equal(target.style.opacity, '0.2');
  assert.equal(calls.at(-1)[3], resources);
  composition.setElement('element', null);
  assert.equal(calls.at(-1)[2], null);
});
