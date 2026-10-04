import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateEffect} from '@sharpforge/rendering';

const graph = blurAmount => ({type: 'GaussianBlur', blurAmount, source: {type: 'Source', name: 'input'}});
function impulse(width) {
  const data = new Float32Array(width * 4);
  data[Math.floor(width / 2) * 4] = 1;
  data[Math.floor(width / 2) * 4 + 3] = 1;
  return {width, height: 1, data};
}
function variance(image) {
  let sum = 0;
  let moment = 0;
  for (let index = 0; index < image.width; index++) {
    const value = image.data[index * 4 + 3];
    sum += value;
    moment += (index - (image.width - 1) / 2) ** 2 * value;
  }
  return moment / sum;
}

test('effect blur scales DIP sigma with DPR before bounded kernel construction', () => {
  const input = impulse(65);
  const low = evaluateEffect(graph(3), {input}, {width: 65, height: 1, dpr: 1});
  const high = evaluateEffect(graph(3), {input}, {width: 65, height: 1, dpr: 2});
  assert.ok(variance(high) / variance(low) > 3.9);
  assert.ok(variance(high) / variance(low) < 4.1);
  assert.ok(high.data[32 * 4] < low.data[32 * 4]);
  assert.deepEqual(low.data, evaluateEffect(graph(3), {input}, {width: 65, height: 1}).data);
});

test('large physical blur preserves normalized premultiplied constant edges', () => {
  const input = {width: 2, height: 2, data: new Float32Array(Array(4).fill([0.2, 0.1, 0, 0.4]).flat())};
  const result = evaluateEffect(graph(64), {input}, {width: 2, height: 2, dpr: 8});
  for (let index = 0; index < result.data.length; index++) assert.ok(Math.abs(result.data[index] - input.data[index]) < 1e-5);
  for (const dpr of [0, -1, NaN, Infinity, 65]) {
    assert.throws(() => evaluateEffect(graph(1), {input}, {width: 2, height: 2, dpr}), /DPR/);
  }
});
