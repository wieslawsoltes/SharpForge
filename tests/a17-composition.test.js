import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEffect, validateEffectGraph} from '../packages/rendering/src/composition/effects.js';
import {createCompositionLight} from '../packages/rendering/src/composition/lights.js';

test('Effect graphs use premultiplied channels and reject unsupported graphs before rendering', () => {
  const input = {width: 1, height: 1, data: new Float32Array([0.5, 0, 0, 0.5])};
  const output = evaluateEffect({type: 'Opacity', opacity: 0.5, sources: [{type: 'Source', name: 'image'}]},
    {image: input}, {width: 1, height: 1});
  assert.deepEqual([...output.data], [0.25, 0, 0, 0.25]);
  assert.throws(() => validateEffectGraph({type: 'Unknown', sources: []}), /UNSUPPORTED/);
  const cycle = {type: 'GaussianBlur'};
  cycle.sources = [cycle];
  assert.throws(() => validateEffectGraph(cycle), /unbounded/);
  for (const kind of ['AmbientLight', 'PointLight', 'SpotLight', 'DistantLight', 'SceneLightingEffect']) {
    assert.throws(() => createCompositionLight(kind), /SF_RENDER_LIGHT_UNSUPPORTED/);
  }
});
