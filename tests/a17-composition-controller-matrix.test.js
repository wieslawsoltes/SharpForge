import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '@sharpforge/framework';
import {Compositor} from '@sharpforge/rendering';

const cases = [
  {kind: 'Scalar', first: 2, last: 6, quarter: 3},
  {kind: 'Vector2', first: [0, 2], last: [4, 6], quarter: [1, 3]},
  {kind: 'Vector3', first: [0, 2, 4], last: [4, 6, 8], quarter: [1, 3, 5]},
  {kind: 'Vector4', first: [0, 2, 4, 6], last: [4, 6, 8, 10], quarter: [1, 3, 5, 7]},
  {kind: 'Color', first: [0, 0, 0, 1], last: [1, 0.5, 0.25, 1], quarter: [0.25, 0.125, 0.0625, 1]},
  {kind: 'Quaternion', first: [0, 0, 0, 1], last: [0, 0, 1, 0], quarter: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)]}
];

function close(actual, expected) {
  const left = Array.isArray(actual) ? actual : [actual], right = Array.isArray(expected) ? expected : [expected];
  assert.equal(left.length, right.length);
  left.forEach((value, index) => assert.ok(Math.abs(value - right[index]) < 1e-12, value + ' != ' + right[index]));
}

for (const entry of cases) test(entry.kind + ': controllers seek exactly and implement each stop policy without retaining stopped records', async () => {
  for (const behavior of [0, 1, 2]) {
    const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
    try {
      const target = compositor.CreatePropertySet();
      target['Insert' + entry.kind]('Value', entry.first);
      const animation = compositor['Create' + entry.kind + 'KeyFrameAnimation']();
      animation.Duration = 1000;
      animation.StopBehavior = behavior;
      animation.InsertKeyFrame(0, entry.first);
      animation.InsertKeyFrame(1, entry.last);
      target.StartAnimation('Value', animation);
      const controller = target.TryGetAnimationController('Value');
      assert.ok(controller);
      controller.Progress = 0.25;
      assert.equal(controller.Progress, 0.25);
      close(target.get('Value'), entry.quarter);
      controller.Pause();
      compositor.advance(500);
      close(target.get('Value'), entry.quarter);
      controller.Resume();
      assert.throws(() => { controller.Progress = -0.01; }, /progress/);
      assert.throws(() => { controller.Progress = 1.01; }, /progress/);
      close(target.get('Value'), entry.quarter);
      target.StopAnimation('Value');
      close(target.get('Value'), [entry.quarter, entry.first, entry.last][behavior]);
      assert.equal(target.TryGetAnimationController('Value'), null);
      assert.equal(compositor.animations.records.size, 0);
      target.StopAnimation('Value');
      animation.dispose(); target.dispose();
      assert.throws(() => target.get('Value'), /disposed/);
    } finally { await compositor.dispose(); }
  }
});
