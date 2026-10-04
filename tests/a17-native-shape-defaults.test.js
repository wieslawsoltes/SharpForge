import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShapeDefaults } from './rendering/native/contract.js';

// Deliberately varied protocol values, not claimed WinUI defaults or a substitute for a native capture.
function observations() {
  return ['Rectangle', 'Ellipse', 'Line', 'Path', 'Polygon', 'Polyline'].map((name, index) => ({
    type: 'Microsoft.UI.Xaml.Shapes.' + name, strokeThickness: index / 2,
    stretch: ['None', 'Fill', 'Uniform', 'UniformToFill'][index % 4],
    strokeHasLocalValue: index % 2 === 0, stretchHasLocalValue: index % 2 !== 0
  }));
}

test('native shape defaults preserve real observations instead of inserting expected values', () => {
  const values = observations();
  const before = structuredClone(values);
  assert.equal(validateShapeDefaults(values), values);
  assert.deepEqual(values, before);
});

test('native shape defaults reject incomplete, duplicate, unknown or malformed observations', () => {
  for (const mutate of [values => values.pop(), values => { values[1] = values[0]; },
    values => { values[0].type = 'Microsoft.UI.Xaml.Shapes.Custom'; },
    values => { values[0].strokeThickness = NaN; }, values => { values[0].strokeThickness = -1; },
    values => { values[0].stretch = 'Custom'; }, values => { values[0].strokeHasLocalValue = 0; },
    values => { values[0].stretchHasLocalValue = 'false'; }]) {
    const values = observations();
    mutate(values);
    assert.throws(() => validateShapeDefaults(values), /SFNPIX025/);
  }
});
