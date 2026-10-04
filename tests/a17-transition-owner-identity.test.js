import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '../packages/framework/src/animation-clock.js';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {ImplicitTransition, ImplicitTransitionCoordinator} from '../packages/rendering/src/animation/implicit-transitions.js';
import {ThemeTransition, ThemeTransitionCoordinator} from '../packages/rendering/src/animation/theme-transitions.js';

function fixture() {
  const compositor = new Compositor({clockFactory: adapter => new AnimationClock(adapter)});
  const visual = compositor.CreateSpriteVisual();
  visual.Size = [20, 10];
  return {compositor, visual, keyFor: owner => owner.h + ':' + owner.g};
}

test('Recreated managed owner references replace one implicit record from its current animated value', () => {
  const {compositor, visual, keyFor} = fixture();
  const transition = new ImplicitTransition('ScalarTransition', 100);
  const coordinator = new ImplicitTransitionCoordinator(compositor, {keyFor, getVisual: () => visual, getTransition: () => transition});
  const original = {h: 1, g: 1}, recreated = {h: 1, g: 1};
  const baseline = compositor.objects.size;
  coordinator.propertyChanged(original, 'Opacity', 0, 1);
  compositor.advance(50);
  assert.equal(visual.Opacity, 0.5);
  coordinator.propertyChanged(recreated, 'Opacity', 1, 0);
  assert.equal(visual.Opacity, 0.5);
  assert.equal(coordinator.active.size, 1);
  assert.deepEqual([...coordinator.retainedValues()].slice(1), [recreated]);
  compositor.advance(50);
  assert.equal(visual.Opacity, 0.25);
  coordinator.cancel({h: 1, g: 1}, 'Opacity');
  assert.equal(visual.Opacity, 0);
  assert.equal(coordinator.active.size, 0);
  assert.equal(compositor.objects.size, baseline);
  assert.deepEqual([...coordinator.retainedValues()], [compositor]);
  coordinator.dispose();
  compositor.dispose();
});

test('Theme cancellation uses stable identity, retains live owners and distinguishes reused heap generations', () => {
  const {compositor, visual, keyFor} = fixture();
  const second = compositor.CreateSpriteVisual();
  const owner = {h: 2, g: 1}, reused = {h: 2, g: 2};
  const coordinator = new ThemeTransitionCoordinator(compositor, {keyFor,
    getVisual: value => value.g === 1 ? visual : second});
  const transition = new ThemeTransition('EntranceThemeTransition');
  const baseline = compositor.objects.size;
  coordinator.start(owner, [transition]);
  coordinator.start(reused, [transition]);
  assert.equal(coordinator.active.size, 2);
  assert.deepEqual([...coordinator.retainedValues()].slice(1), [owner, reused]);
  coordinator.cancel({h: 2, g: 1});
  assert.equal(coordinator.active.size, 1);
  assert.equal(visual.Opacity, 1);
  assert.equal(second.Opacity, 0);
  coordinator.start({h: 2, g: 2}, []);
  assert.equal(coordinator.active.size, 0);
  assert.equal(second.Opacity, 1);
  assert.equal(compositor.objects.size, baseline);
  coordinator.dispose();
  compositor.dispose();
});

test('Wrong implicit value types fail before replacing the current owner animation', () => {
  const {compositor, visual, keyFor} = fixture();
  let transition = new ImplicitTransition('ScalarTransition', 100);
  const coordinator = new ImplicitTransitionCoordinator(compositor, {keyFor, getVisual: () => visual, getTransition: () => transition});
  coordinator.propertyChanged({h: 1, g: 1}, 'Opacity', 0, 1);
  compositor.advance(25);
  const count = compositor.objects.size;
  transition = new ImplicitTransition('Vector3Transition', 100);
  assert.throws(() => coordinator.propertyChanged({h: 1, g: 1}, 'Opacity', 1, 0), /value type/);
  assert.equal(visual.Opacity, 0.25);
  assert.equal(compositor.objects.size, count);
  assert.equal(coordinator.active.size, 1);
  coordinator.dispose();
  assert.equal(coordinator.active.size, 0);
  compositor.dispose();
});

test('Implicit completion looks up the restored record map after snapshot rewind', () => {
  const {compositor, visual, keyFor} = fixture();
  const transition = new ImplicitTransition('ScalarTransition', 100);
  const coordinator = new ImplicitTransitionCoordinator(compositor, {keyFor, getVisual: () => visual, getTransition: () => transition});
  const baseline = compositor.objects.size;
  coordinator.propertyChanged({h: 1, g: 1}, 'Opacity', 0, 1);
  compositor.advance(25);
  const composition = compositor.snapshot(), transitions = coordinator.snapshot();
  coordinator.cancel({h: 1, g: 1}, 'Opacity');
  compositor.restore(composition);
  coordinator.restore(transitions);
  compositor.advance(75);
  assert.equal(visual.Opacity, 1);
  assert.equal(coordinator.active.size, 0);
  assert.equal(compositor.objects.size, baseline);
  coordinator.dispose();
  compositor.dispose();
});
