import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock, easing} from '@sharpforge/framework';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {prepareValueAnimation, sampleValueAnimation, interpolateValue} from '../packages/rendering/src/animation/value-sampler.js';
import {parseCompositionExpression} from '../packages/rendering/src/composition/expression-parser.js';
import {evaluateCompositionExpression} from '../packages/rendering/src/composition/expression-evaluator.js';
import {resolveAnimationTarget} from '../packages/rendering/src/animation/property-path.js';

const compositor = () => new Compositor({clockFactory: adapter => new AnimationClock(adapter)});

test('Color, point, object, vector and quaternion samplers preserve typed values and discrete boundaries', () => {
  const point = prepareValueAnimation({valueKind: 'Point', from: {X: 0, Y: 2}, to: {X: 10, Y: 12}}, {X: 0, Y: 0});
  assert.deepEqual(sampleValueAnimation(point, 0.5), {X: 5, Y: 7});
  const color = prepareValueAnimation({valueKind: 'Color', from: {R: 255, G: 0, B: 0, A: 255},
    to: {R: 0, G: 0, B: 255, A: 255}}, {R: 0, G: 0, B: 0, A: 0});
  assert.deepEqual(sampleValueAnimation(color, 0.5), {R: 128, G: 0, B: 128, A: 255});
  const object = prepareValueAnimation({valueKind: 'Object', keyFrames: [{progress: 0.5, value: 'middle'}, {progress: 1, value: 'end'}]}, 'start');
  assert.equal(sampleValueAnimation(object, 0.49999), 'start');
  assert.equal(sampleValueAnimation(object, 0.5), 'middle');
  assert.deepEqual(interpolateValue('Vector3', [0, 2, 4], [2, 4, 6], 0.5), [1, 3, 5]);
  const quaternion = interpolateValue('Quaternion', [0, 0, 0, 1], [0, 0, 1, 0], 0.5);
  assert(Math.abs(quaternion[2] - Math.SQRT1_2) < 1e-10);
  assert(Math.abs(Math.hypot(...quaternion) - 1) < 1e-10);
});

test('All eleven easing families have exact endpoints and symmetric EaseInOut midpoints', () => {
  const families = ['QuadraticEase', 'CubicEase', 'QuarticEase', 'QuinticEase', 'PowerEase', 'SineEase',
    'CircleEase', 'BackEase', 'BounceEase', 'ElasticEase', 'ExponentialEase'];
  for (const kind of families) for (const mode of [0, 1, 2]) {
    assert.equal(easing(0, {kind, mode}), 0);
    assert.equal(easing(1, {kind, mode}), 1);
    assert.equal(easing(0.5, {kind, mode: 2}), 0.5);
  }
  assert.throws(() => easing(0.5, {kind: 'BounceEase', bounces: 100}));
});

test('Controller seek, pause, repeat direction, stop behavior and batch completion are deterministic', async () => {
  const comp = compositor();
  const visual = comp.CreateSpriteVisual();
  const animation = comp.CreateScalarKeyFrameAnimation();
  animation.Duration = 1000;
  animation.StopBehavior = 1;
  animation.InsertKeyFrame(0, 0);
  animation.InsertKeyFrame(1, 1);
  let completed = 0;
  const batch = comp.CreateScopedBatch();
  batch.add_Completed(() => completed++);
  const controller = visual.StartAnimation('Opacity', animation);
  batch.End();
  controller.Progress = 0.4;
  assert.equal(visual.Opacity, 0.4);
  controller.Pause();
  comp.animations.advance(200);
  assert.equal(visual.Opacity, 0.4);
  controller.Resume();
  controller.PlaybackRate = 2;
  comp.animations.advance(100);
  assert.equal(visual.Opacity, 0.6);
  visual.StopAnimation('Opacity');
  assert.equal(visual.Opacity, 1);
  assert.equal(completed, 1);
  visual.StopAnimation('Opacity');
  assert.equal(completed, 1);
  await comp.dispose();
});

test('Expressions safely track live property sets and reject code/prototype access', async () => {
  const comp = compositor();
  const scroll = comp.CreatePropertySet();
  scroll.InsertVector3('Translation', [0, 4, 0]);
  const visual = comp.CreateSpriteVisual();
  const expression = comp.CreateExpressionAnimation('scroll.Translation.Y * 0.5');
  expression.SetReferenceParameter('scroll', scroll);
  visual.StartAnimation('RotationAngle', expression);
  assert.equal(visual.RotationAngle, 2);
  scroll.InsertVector3('Translation', [0, 10, 0]);
  comp.animations.advance(16);
  assert.equal(visual.RotationAngle, 5);
  for (const text of ['constructor.constructor(1)', 'scroll.__proto__', 'while(true){}', 'Vector3(1,2)']) {
    assert.throws(() => evaluateCompositionExpression(parseCompositionExpression(text), {scroll}));
  }
  assert.throws(() => parseCompositionExpression('x'.repeat(4097)));
  await comp.dispose();
});

test('Nested storyboard paths validate their whole chain before returning a target', () => {
  const brush = {Color: {R: 255, G: 0, B: 0, A: 255}};
  const target = {Background: brush};
  const adapter = {read: (object, name) => object[name], property: (object, name) => Object.hasOwn(object, name) ? {} : null};
  assert.deepEqual(resolveAnimationTarget(target, '(Panel.Background).(SolidColorBrush.Color)', adapter), {object: brush, property: 'Color', info: {}});
  assert.throws(() => resolveAnimationTarget(target, '(Panel.Background).(SolidColorBrush.Missing)', adapter));
  assert.throws(() => resolveAnimationTarget(target, 'Background[0].Color', adapter));
});
