import test from 'node:test';
import assert from 'node:assert/strict';
import {AnimationClock} from '../packages/framework/src/animation-clock.js';
import {Compositor} from '../packages/rendering/src/composition/compositor.js';
import {ThemeTransition, ThemeTransitionCoordinator} from '../packages/rendering/src/animation/theme-transitions.js';
import {ImplicitTransition, ImplicitTransitionCoordinator} from '../packages/rendering/src/animation/implicit-transitions.js';

const create = () => new Compositor({clockFactory: adapter => new AnimationClock(adapter)});

test('ChildrenTransitions animate entrance after layout and honor reduced motion without leaking definitions', () => {
  const compositor = create(), visual = compositor.CreateSpriteVisual();
  visual.Size = [30, 20];
  const panel = {ChildrenTransitions: [new ThemeTransition('EntranceThemeTransition')]};
  const child = {};
  let reduced = false;
  const coordinator = new ThemeTransitionCoordinator(compositor, {getVisual: () => visual, reducedMotion: () => reduced});
  const baseline = compositor.objects.size;
  coordinator.childAdded(panel, child);
  assert.equal(visual.Opacity, 0);
  assert.deepEqual(visual.Offset, [0, 24, 0]);
  compositor.advance(250);
  assert.equal(visual.Opacity, 1);
  assert.deepEqual(visual.Offset, [0, 0, 0]);
  assert.equal(compositor.objects.size, baseline);
  reduced = true;
  assert.equal(coordinator.childAdded(panel, child), null);
  assert.equal(coordinator.active.size, 0);
  coordinator.dispose();
  compositor.dispose();
});

test('Scalar and Vector3 implicit transitions apply transient values and clear their resources on cancellation', () => {
  const compositor = create(), visual = compositor.CreateSpriteVisual();
  const element = {}, scalar = new ImplicitTransition('ScalarTransition', 100), vector = new ImplicitTransition('Vector3Transition', 100);
  const coordinator = new ImplicitTransitionCoordinator(compositor, {getVisual: () => visual,
    getTransition: (target, name) => name === 'OpacityTransition' ? scalar : vector});
  coordinator.propertyChanged(element, 'Opacity', 0, 1);
  compositor.advance(50);
  assert.equal(visual.Opacity, 0.5);
  compositor.advance(50);
  assert.equal(visual.Opacity, 1);
  coordinator.propertyChanged(element, 'Translation', [0, 0, 0], [10, 20, 0]);
  compositor.advance(25);
  assert.deepEqual(visual.Properties.get('Translation'), [2.5, 5, 0]);
  coordinator.cancel(element, 'Translation');
  assert.equal(coordinator.active.size, 0);
  scalar.Duration = -1;
  assert.throws(() => coordinator.propertyChanged(element, 'Opacity', 0, 1), /duration/);
  coordinator.dispose();
  compositor.dispose();
});
