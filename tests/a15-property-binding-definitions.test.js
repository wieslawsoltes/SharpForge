import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Binding, BindingBase, BindingMode, RelativeSource, RelativeSourceMode, PropertyPath,
  BindingPathError, parsePropertyPath, UnsetValue
} from '@sharpforge/winui-properties';

test('A15 binding definitions preserve absent versus explicit-null sources across snapshots', () => {
  const binding = new Binding();
  assert(binding instanceof BindingBase);
  assert.equal(binding.Source, UnsetValue);
  assert.equal(binding.FallbackValue, UnsetValue);
  assert.equal(binding.Mode, BindingMode.OneWay);
  binding.Source = null;
  binding.FallbackValue = null;
  const saved = binding.snapshot();
  binding.Source = {value: 3};
  binding.FallbackValue = 'later';
  binding.restore(saved);
  assert.equal(binding.Source, null);
  assert.equal(binding.FallbackValue, null);
  assert.throws(() => binding.restore({version: 2, values: {}}), TypeError);
  const relative = new RelativeSource(RelativeSourceMode.Self);
  const relativeSaved = relative.snapshot();
  relative.Mode = RelativeSourceMode.TemplatedParent;
  relative.restore(relativeSaved);
  assert.equal(relative.Mode, RelativeSourceMode.Self);
  assert.throws(() => relative.restore({version: 1, Mode: 100}), TypeError);
});

test('A15 path definitions freeze bounded parsed steps and preserve positional failures', () => {
  const path = new PropertyPath("Items['a.b'][2].(Grid.Row)");
  const steps = parsePropertyPath(path);
  assert(Object.isFrozen(path));
  assert(Object.isFrozen(steps));
  assert(steps.every(Object.isFrozen));
  assert.deepEqual(steps.map(step => step.kind), ['property', 'index', 'index', 'attached']);
  assert.equal(steps[1].key, 'a.b');
  assert.equal(steps[3].owner, 'Grid');
  assert.throws(() => new PropertyPath(12), TypeError);
  assert.throws(() => parsePropertyPath('A.B', {maxSegments: 1}), BindingPathError);
  assert.throws(() => parsePropertyPath('AB', {maxLength: 1}), BindingPathError);
  assert.throws(() => parsePropertyPath('Items[9007199254740992]'), BindingPathError);
  assert.throws(() => parsePropertyPath('Child.'), error => error instanceof BindingPathError && error.position === 6);
});
