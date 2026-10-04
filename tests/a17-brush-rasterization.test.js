import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterizeBrush} from '../packages/rendering/src/brushes/rasterizer.js';
import {evaluateWorkingEffect} from '../packages/rendering/src/brushes/working-effects.js';

test('software brush sampling writes physical pixel centers and enforces the allocation budget', () => {
  const writes = [], allocations = [];
  const options = {dpr: 2, maxPixels: 8, createCanvas(width, height) {
    allocations.push([width, height]);
    return {getContext: () => ({createImageData: (w, h) => ({width: w, height: h, data: new Uint8ClampedArray(w * h * 4)}),
      putImageData(image) { writes.push(image); }})};
  }};
  const raster = rasterizeBrush({kind: 'linear', start: [0, 0], end: [1, 0],
    stops: [{offset: 0, color: 'black'}, {offset: 1, color: 'white'}]}, [10, 20, 1, 1], null, options);
  assert.deepEqual([raster.width, raster.height], [2, 2]);
  assert.deepEqual([...writes[0].data], [64, 64, 64, 255, 191, 191, 191, 255, 64, 64, 64, 255, 191, 191, 191, 255]);
  assert.throws(() => rasterizeBrush('red', [0, 0, 2, 2], null, options), error => error.code === 'SFRENDER067');
  assert.deepEqual(allocations, [[2, 2]]);
});

test('working-space effects distinguish linear light from sRGB while retaining premultiplied alpha', () => {
  const graph = {type: 'Blend', mode: 'SourceOver', sources: [
    {type: 'ColorSource', color: [1, 1, 1, 0.5]}, {type: 'ColorSource', color: [0, 0, 0, 1]}
  ]};
  const srgb = evaluateWorkingEffect(graph, {}, {width: 1, height: 1, blendColorSpace: 'srgb'});
  const linear = evaluateWorkingEffect(graph, {}, {width: 1, height: 1, blendColorSpace: 'linear'});
  assert.deepEqual([...srgb.data], [0.5, 0.5, 0.5, 1]);
  for (const channel of linear.data.slice(0, 3)) assert.ok(Math.abs(channel - 0.7353569830524495) < 1e-6);
  assert.equal(linear.data[3], 1);
});
