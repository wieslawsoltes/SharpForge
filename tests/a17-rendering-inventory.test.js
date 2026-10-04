import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderingCoverage} from '../packages/rendering/tools/coverage.js';

test('unknown operations are marked for runtime review rather than being counted as implemented adapters', () => {
  const manifest = {version: 1, types: [{name: 'Microsoft.UI.Xaml.Controls.NewControl', base: 'object', kind: 'control'}],
    members: [{id: 7, owner: 'Microsoft.UI.Xaml.Controls.NewControl', name: 'Unimplemented', kind: 'method',
      parameters: [], result: 'void', isStatic: false}]};
  const inventory = createRenderingCoverage(manifest);
  assert.equal(inventory.members[0].status, 'review-runtime-dispatch');
  assert.equal(inventory.types[0].rendering.webgpu, 'dom-fallback');
});
