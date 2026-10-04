import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleEasing as easing} from '@sharpforge/rendering';
import {prepareValueAnimation, sampleValueAnimation, interpolateValue} from '../packages/rendering/src/animation/value-sampler.js';
import {resolveAnimationTarget} from '../packages/rendering/src/animation/property-path.js';

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

test('Nested storyboard paths validate their whole chain before returning a target', () => {
  const brush = {Color: {R: 255, G: 0, B: 0, A: 255}};
  const target = {Background: brush};
  const adapter = {read: (object, name) => object[name], property: (object, name) => Object.hasOwn(object, name) ? {} : null};
  assert.deepEqual(resolveAnimationTarget(target, '(Panel.Background).(SolidColorBrush.Color)', adapter), {object: brush, property: 'Color', info: {}});
  assert.throws(() => resolveAnimationTarget(target, '(Panel.Background).(SolidColorBrush.Missing)', adapter));
  assert.throws(() => resolveAnimationTarget(target, 'Background[0].Color', adapter));
});
