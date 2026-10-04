import test from 'node:test';
import assert from 'node:assert/strict';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {serializeCompositionGraph, applyCompositionGraph} from '../packages/rendering/src/composition/transport-codec.js';
import {normalizeBrush} from '../packages/rendering/src/brushes/brushes.js';

test('CompositionStrokeDashArray edits invalidate retained shape content, preserve snapshots and transport exact values', async () => {
  const compositor = new Compositor(), host = new Compositor();
  const visual = compositor.CreateShapeVisual();
  visual.Size = [50, 40];
  const geometry = compositor.CreateRectangleGeometry();
  geometry.Size = [30, 20];
  const shape = compositor.CreateSpriteShape(geometry);
  shape.StrokeBrush = compositor.CreateColorBrush([1, 0, 0, 1]);
  shape.StrokeDashCap = 2;
  visual.Shapes.Add(shape);
  compositor.attach(visual);
  const before = compositor.layers()[0].displayList;
  const dashes = shape.StrokeDashArray;
  dashes.Add(0);
  dashes.Append(2);
  assert.equal(dashes.Size, 2);
  assert.notEqual(compositor.layers()[0].displayList, before);
  const saved = compositor.snapshot();
  dashes.set_Item(1, 3);
  dashes.InsertAt(0, 1);
  compositor.restore(saved);
  assert.equal(shape.StrokeDashArray, dashes);
  assert.deepEqual([...dashes], [0, 2]);
  const graph = structuredClone(serializeCompositionGraph(compositor));
  const objects = applyCompositionGraph(host, graph);
  assert.deepEqual([...objects.get(shape.id).StrokeDashArray], [0, 2]);
  assert.equal(objects.get(shape.id).StrokeDashCap, 2);
  const destination = [8, 8, 8];
  dashes.CopyTo(destination, 1);
  assert.deepEqual(destination, [8, 0, 2]);
  assert.equal(dashes.Remove(8), false);
  assert.equal(dashes.Remove(0), true);
  await compositor.dispose();
  assert.throws(() => dashes.Add(2), /disposed/);
  await host.dispose();
});

test('Dash collection validation is bounded and atomic for invalid indices and replacement values', async () => {
  const compositor = new Compositor();
  const shape = compositor.CreateSpriteShape();
  const values = shape.StrokeDashArray;
  values.ReplaceAll([1, 2]);
  for (const invalid of [[-1], [Infinity], Array(257).fill(1), {length: 2}, new DataView(new ArrayBuffer(8))]) {
    assert.throws(() => values.ReplaceAll(invalid));
    assert.deepEqual([...values], [1, 2]);
  }
  assert.throws(() => values.InsertAt(3, 1), RangeError);
  assert.throws(() => values.set_Item(0, NaN));
  assert.throws(() => { shape.StrokeDashArray = []; }, TypeError);
  values.ReplaceAll(Array(256).fill(1));
  assert.throws(() => values.Add(2), /limit/);
  values.Clear();
  assert.throws(() => values.RemoveAtEnd(), RangeError);
  await compositor.dispose();
});

test('Composition RGB interpolation maps to the corresponding drawing interpolation space', async () => {
  const compositor = new Compositor();
  const brush = compositor.CreateLinearGradientBrush();
  brush.ColorStops.Add(compositor.CreateColorGradientStop(0, [0, 0, 0, 1]));
  brush.ColorStops.Add(compositor.CreateColorGradientStop(1, [1, 1, 1, 1]));
  for (const [space, expected] of [[0, 'srgb'], [2, 'srgb'], [4, 'linear']]) {
    brush.InterpolationSpace = space;
    assert.equal(normalizeBrush(brush.descriptor()).interpolation, expected);
  }
  assert.throws(() => { brush.InterpolationSpace = 1; }, /UNSUPPORTED/);
  await compositor.dispose();
});
