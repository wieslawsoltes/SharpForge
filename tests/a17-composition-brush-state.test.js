import test from 'node:test';
import assert from 'node:assert/strict';
import {CompositionColorBrush, CompositionLinearGradientBrush, CompositionColorGradientStop,
  CompositionMaskBrush, CompositionEffectFactory} from '@sharpforge/rendering';
import {compositionOwner} from './fixtures/rendering/composition-owner.js';

test('composition brush descriptors retain typed gradient stops and explicit interpolation policy', () => {
  const owner = compositionOwner();
  const brush = new CompositionLinearGradientBrush(owner);
  const stop = new CompositionColorGradientStop(owner, 0.25, [1, 0, 0, 1]);
  brush.ColorStops.Add(stop);
  brush.InterpolationSpace = 4;
  assert.equal(brush.descriptor().ColorInterpolationMode, 0);
  stop.Color = [0, 0, 1, 1];
  assert.deepEqual(brush.descriptor().ColorStops, [{Offset: 0.25, Color: [0, 0, 1, 1]}]);
  for (const mode of [0, 2]) {
    brush.InterpolationSpace = mode;
    assert.equal(brush.descriptor().ColorInterpolationMode, 1);
  }
  assert.throws(() => { brush.InterpolationSpace = 3; }, /UNSUPPORTED/);
  assert.throws(() => brush.ColorStops.Add(new CompositionColorGradientStop(compositionOwner())), /same Compositor/);
  brush.dispose();
  stop.dispose();
  assert.equal(owner.objects.size, 0);
});

test('composition effect sources reject foreign resources, unknown names and cycles before descriptor recursion', () => {
  const owner = compositionOwner();
  const factory = new CompositionEffectFactory(owner, {type: 'Opacity', opacity: 0.5,
    sources: [{type: 'Source', name: 'input'}]});
  const effect = factory.CreateBrush();
  const source = new CompositionColorBrush(owner, [1, 0, 0, 1]);
  effect.SetSourceParameter('input', source);
  assert.equal(effect.descriptor().sources.input.kind, 'CompositionColorBrush');
  assert.throws(() => effect.SetSourceParameter('unknown', source), /Unknown effect source/);
  assert.throws(() => effect.SetSourceParameter('input', new CompositionColorBrush(compositionOwner())), /same Compositor/);
  const mask = new CompositionMaskBrush(owner);
  mask.Source = effect;
  assert.throws(() => effect.SetSourceParameter('input', mask), /cycle/);
  assert.equal(effect.GetSourceParameter('input'), source);
  effect.SetSourceParameter('input', null);
  assert.equal(effect.GetSourceParameter('input'), null);
  factory.dispose();
  assert.throws(() => factory.CreateBrush(), /disposed/);
  for (const object of [...owner.objects.values()]) object.dispose();
  assert.equal(owner.objects.size, 0);
});
