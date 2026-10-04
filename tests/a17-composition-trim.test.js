import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {DrawOp} from '../packages/rendering/src/drawing/commands.js';

test('Twenty manual-clock trim samples encode the expected partial line without changing its source geometry', async () => {
  const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
  const visual = compositor.CreateShapeVisual();
  visual.Size = [110, 20];
  const geometry = compositor.CreateLineGeometry();
  geometry.Start = [0, 10];
  geometry.End = [100, 10];
  const shape = compositor.CreateSpriteShape(geometry);
  shape.StrokeThickness = 2;
  shape.StrokeBrush = compositor.CreateColorBrush([0, 0, 0, 1]);
  visual.Shapes.Add(shape);
  compositor.attach(visual);
  const animation = compositor.CreateScalarKeyFrameAnimation();
  animation.Duration = 1000;
  animation.InsertKeyFrame(0, 0);
  animation.InsertKeyFrame(1, 1);
  geometry.StartAnimation('TrimEnd', animation);
  for (let sample = 0; sample < 20; sample++) {
    const list = compositor.layers()[0].displayList;
    const partial = list.commands.find(command => command.op === DrawOp.Geometry).geometry;
    if (!sample) assert.deepEqual(partial.figures, []);
    else {
      assert.deepEqual(partial.figures[0].start, [0, 10]);
      const end = partial.figures[0].segments.at(-1).end;
      // Fractional timeline progress and path interpolation can differ by a few binary rounding units.
      assert.ok(Math.abs(end[0] - sample * 5) < 1e-9, 'The trimmed endpoint is within one billionth of a DIP');
      assert.equal(end[1], 10);
    }
    assert.deepEqual(geometry.End, [100, 10]);
    compositor.advance(50);
  }
  assert.throws(() => { geometry.TrimStart = -0.1; });
  assert.throws(() => { geometry.TrimEnd = 1.1; });
  await compositor.dispose();
});
