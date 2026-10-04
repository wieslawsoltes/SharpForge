import test from 'node:test';
import assert from 'node:assert/strict';
import {ContainerVisual, SpriteVisual, ShapeVisual, CompositionSpriteShape, CompositionRectangleGeometry,
  CompositionColorBrush, InsetClip, DropShadow} from '@sharpforge/rendering';
import {compositionOwner} from './fixtures/rendering/composition-owner.js';

test('native visual models keep bounded owned children, affine placement and clip coordinates independent of rendering', () => {
  const owner = compositionOwner();
  owner.maxVisuals = 2;
  const root = new ContainerVisual(owner);
  const child = new SpriteVisual(owner);
  child.Size = [20, 10];
  child.Offset = [5, 7, 0];
  child.Clip = new InsetClip(owner, 1, 2, 3, 4);
  root.Children.InsertAtTop(child);
  assert.equal(child.parent, root);
  assert.deepEqual(child.matrix().slice(12, 15), [5, 7, 0]);
  assert.deepEqual(child.Clip.descriptor(child.Size).rect, [1, 2, 16, 4]);
  assert.throws(() => root.Children.InsertAtTop(child), /parent/);
  assert.throws(() => child.Children.InsertAtTop(root), /cycle/);
  assert.throws(() => { child.Size = [-1, 1]; }, /Size/);
  assert.throws(() => { child.Brush = new CompositionColorBrush(compositionOwner()); }, /same Compositor/);
  const snapshot = child.snapshot();
  child.Offset = [30, 40, 0];
  child.restore(snapshot);
  assert.deepEqual(child.Offset, [5, 7, 0]);
  root.Children.Remove(child);
  assert.equal(child.parent, null);
  for (const object of [...owner.objects.values()]) object.dispose();
  assert.equal(owner.objects.size, 0);
});

test('shape collections and dash arrays invalidate owned content and preserve typed shadow state', () => {
  const owner = compositionOwner();
  const visual = new ShapeVisual(owner);
  const geometry = new CompositionRectangleGeometry(owner);
  geometry.Size = [40, 20];
  const shape = new CompositionSpriteShape(owner, geometry);
  visual.Shapes.Add(shape);
  const prior = shape.version;
  shape.StrokeDashArray.Add(0);
  shape.StrokeDashArray.Add(2);
  assert.ok(shape.version > prior);
  assert.deepEqual([...shape.StrokeDashArray], [0, 2]);
  assert.throws(() => shape.StrokeDashArray.Add(-1), /entry/);
  const shadow = new DropShadow(owner);
  shadow.Offset = [3, 4, 0];
  shadow.BlurRadius = 8;
  assert.deepEqual(shadow.descriptor().offset, [3, 4, 0]);
  assert.equal(shadow.descriptor().blurRadius, 8);
  visual.Shapes.Clear();
  assert.equal(visual.Shapes.Count, 0);
  for (const object of [...owner.objects.values()]) object.dispose();
  assert.equal(owner.objects.size, 0);
  assert.throws(() => shape.StrokeDashArray.Add(1), /disposed/);
});
