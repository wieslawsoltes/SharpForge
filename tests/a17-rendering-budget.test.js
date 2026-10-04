import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRenderingBudget} from './rendering/budgets.bench.js';

const measurement = () => ({status: 'passed', actualBackend: 'webgpu', actualTier: 'software', browserVersion: 'pinned-browser',
  adapter: {description: 'SwiftShader', driver: 'pinned-driver'}, fixture: {id: 'shapes', width: 128, height: 96},
  pixelDimensions: [128, 96], captureMode: 'retained-readback', metrics: {cpuMedianMs: 1, cpuP95Ms: 2}});
const limits = {cpuMedianMs: 4, cpuP95Ms: 8};

test('Budgets accept finite real adapter measurements and enforce matched 5% regression limits', () => {
  const baseline = measurement(), current = measurement();
  assert.equal(verifyRenderingBudget(current, limits, baseline).passed, true);
  current.metrics.cpuP95Ms = 2.11;
  assert.match(verifyRenderingBudget(current, limits, baseline).failures.join(), /5%/);
  current.metrics.cpuP95Ms = 2;
  current.pixelDimensions = [256, 192];
  assert.match(verifyRenderingBudget(current, limits, baseline).failures.join(), /resolution/);
});

test('Budgets reject mocks, missing values, negative/NaN readings and incomplete regression baselines', () => {
  for (const value of [undefined, null, NaN, Infinity, -1]) {
    const result = measurement();
    result.metrics.cpuP95Ms = value;
    assert.equal(verifyRenderingBudget(result, limits).passed, false);
  }
  for (const change of [{mockGpu: true}, {actualTier: 'unverified'}, {actualBackend: 'canvas2d'}, {status: 'failed'}]) {
    assert.equal(verifyRenderingBudget({...measurement(), ...change}, limits).passed, false);
  }
  assert.equal(verifyRenderingBudget(measurement(), {}).passed, false);
  assert.equal(verifyRenderingBudget(measurement(), {cpuMedianMs: NaN}).passed, false);
  assert.equal(verifyRenderingBudget(measurement(), limits, null, {requireBaseline: true}).passed, false);
  const baseline = measurement();
  delete baseline.metrics.cpuMedianMs;
  assert.equal(verifyRenderingBudget(measurement(), limits, baseline).passed, false);
});
