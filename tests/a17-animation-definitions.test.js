import test from 'node:test';
import assert from 'node:assert/strict';
import {KeyFrameAnimation, ExpressionAnimation, CompositionPropertySet, prepareValueAnimation, sampleValueAnimation,
  parseCompositionExpression, evaluateCompositionExpression} from '@sharpforge/rendering';
import {compositionOwner} from './fixtures/rendering/composition-owner.js';

test('composition keyframe definitions capture values and parameters and preserve replacement and input bounds', () => {
  const owner = compositionOwner();
  const animation = new KeyFrameAnimation(owner, 'Vector2');
  const input = [2, 4];
  const destination = [6, 12];
  animation.InsertKeyFrame(0, input);
  animation.SetVector2Parameter('destination', destination);
  animation.InsertExpressionKeyFrame(1, 'destination');
  const definition = animation.definition([0, 0]);
  input[0] = 100;
  destination[0] = 600;
  animation.SetVector2Parameter('destination', [10, 20]);
  assert.deepEqual(sampleValueAnimation(prepareValueAnimation(definition, [0, 0]), 0.5), [4, 8]);
  animation.InsertKeyFrame(0, [0, 2]);
  assert.equal(animation.KeyFrameCount, 2);
  assert.throws(() => animation.InsertKeyFrame(-0.1, [0, 0]), /progress/);
  assert.throws(() => animation.InsertKeyFrame(0.5, [1, 2, 3]), /Vector2|components|component/);
  animation.Duration = -1;
  assert.throws(() => animation.definition([0, 0]), /duration/);
  animation.dispose();
  assert.equal(owner.objects.size, 0);
  assert.throws(() => animation.definition([0, 0]), /live animation/);
});

test('composition expressions read live typed parameters and reject executable or unbounded expressions', () => {
  const owner = compositionOwner();
  const values = new CompositionPropertySet(owner);
  values.InsertScalar('Progress', 0.25);
  const expression = new ExpressionAnimation(owner, 'Lerp(0, 100, values.Progress)');
  expression.SetReferenceParameter('values', values);
  const compiled = expression.compile();
  assert.equal(evaluateCompositionExpression(compiled.ast, compiled.parameters), 25);
  values.InsertScalar('Progress', 0.75);
  assert.equal(evaluateCompositionExpression(compiled.ast, compiled.parameters), 75);
  assert.throws(() => expression.SetReferenceParameter('foreign', new CompositionPropertySet(compositionOwner())), /Foreign/);
  assert.throws(() => parseCompositionExpression('values.constructor()'), /forbidden|Unsupported|Invalid|Unexpected/i);
  assert.throws(() => evaluateCompositionExpression(parseCompositionExpression('1 + 2 * 3'), {}, {maxOperations: 2}), /limit/);
  assert.throws(() => evaluateCompositionExpression(parseCompositionExpression('1 / 0'), {}), /Nonfinite/);
  expression.dispose();
  values.dispose();
  assert.equal(owner.objects.size, 0);
  assert.throws(() => expression.compile(), /disposed/);
});
