import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AnimationClock} from '../../packages/framework/src/animation-clock.js';
import {Compositor} from '../../packages/rendering/src/composition/compositor.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/animation-traces.json', import.meta.url), 'utf8'));

function traceEqual(actual, expected, tolerance, path = '') {
  if (typeof expected === 'number') assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} != ${expected}`);
  else for (const [name, value] of Object.entries(expected)) traceEqual(actual[name], value, tolerance, path + '.' + name);
}

for (const scenario of fixture.cases) test('manual XAML trace: ' + scenario.id, () => {
  let value = scenario.definition.from;
  const clock = new AnimationClock({key: target => target, read: () => value, readBase: () => scenario.definition.from,
    validate() {}, write: (target, name, next) => { value = next; }});
  clock.begin('trace', {...scenario.definition, target: 'element', property: 'value'});
  for (const sample of scenario.samples) {
    clock.seek('trace', sample.time);
    traceEqual(value, sample.value, fixture.tolerance, scenario.id + '@' + sample.time);
  }
  clock.clear();
});

test('composition reverse trace has 20 exact samples and deterministic pause/resume', () => {
  const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
  const visual = compositor.CreateSpriteVisual();
  const animation = compositor.CreateScalarKeyFrameAnimation();
  animation.Duration = 1000;
  animation.Direction = 2;
  animation.IterationCount = 2;
  animation.InsertKeyFrame(0, 0);
  animation.InsertKeyFrame(1, 1);
  visual.StartAnimation('Opacity', animation);
  for (let index = 0; index < 20; index++) {
    const expected = index <= 10 ? index / 10 : 2 - index / 10;
    traceEqual(visual.Opacity, expected, fixture.tolerance);
    compositor.advance(100);
  }
  compositor.dispose();
});

test('trace comparison fails a sample outside the stated tolerance', () => {
  assert.throws(() => traceEqual({X: 1.01}, {X: 1}, 0.001), /1.01/);
});
