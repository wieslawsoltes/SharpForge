import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkType } from '@sharpforge/framework';

test('unspecified inertia desired values explicitly permit their NaN metadata sentinel', () => {
  for (const [kind, desired] of [['Translation', 'Displacement'], ['Rotation', 'Rotation'], ['Expansion', 'Expansion']]) {
    const type = frameworkType('Microsoft.UI.Xaml.Input.Inertia' + kind + 'Behavior');
    for (const name of ['DesiredDeceleration', 'Desired' + desired]) {
      assert(Number.isNaN(type.properties[name].value));
      assert.equal(type.properties[name].metadata.allowNaN, true);
    }
  }
});
