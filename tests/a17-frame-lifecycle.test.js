import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameScheduler} from '../packages/rendering/src/frame-scheduler.js';
import {DirtyRegions} from '../packages/rendering/src/dirty-regions.js';
import {LayerCache} from '../packages/rendering/src/layer-cache.js';
import {FrameMetrics} from '../packages/rendering/src/frame-metrics.js';

test('The shared scheduler coalesces invalidations and animations in declared phase order', () => {
  const queued = new Map();
  const phases = [];
  let serial = 0;
  const scheduler = new FrameScheduler({requestFrame: callback => { queued.set(++serial, callback); return serial; },
    cancelFrame: id => queued.delete(id)});
  for (const phase of ['input', 'layout', 'animation', 'build', 'submit', 'present']) scheduler.register(phase, phase, () => phases.push(phase));
  scheduler.invalidate('layout');
  scheduler.invalidate('input');
  scheduler.setContinuous('opacity', true);
  assert.equal(queued.size, 1);
  const callback = queued.values().next().value;
  queued.clear();
  callback(100);
  assert.deepEqual(phases, ['input', 'layout', 'animation', 'build', 'submit', 'present']);
  assert.equal(queued.size, 1);
  scheduler.dispose();
  assert.equal(queued.size, 0);
  assert.throws(() => scheduler.register('layout', 'late', () => {}));
});

test('Small damage uses under five percent of a preserved 1080p surface', () => {
  const dirty = new DirtyRegions({width: 1920, height: 1080});
  assert.equal(dirty.consume({preservedContents: true}).full, true);
  dirty.moved('root', [10, 10, 30, 40], [15, 10, 30, 40], 1);
  const damage = dirty.consume({preservedContents: true});
  assert.equal(damage.full, false);
  assert(damage.fraction < 0.05);
  dirty.add('root', [20, 20, 1, 1]);
  assert.equal(dirty.consume({preservedContents: false}).full, true);
  assert.throws(() => dirty.add('root', [0, 0, -1, 1]));
});

test('Layer cache keeps static content during placement changes and evicts by byte budget', () => {
  const cache = new LayerCache({maxBytes: 20});
  let rasterized = 0;
  let destroyed = 0;
  const entry = version => ({version, bytes: 10, create: () => ({serial: ++rasterized}), destroy: () => destroyed++});
  const first = cache.getOrCreate('list', entry(1));
  for (let scroll = 0; scroll < 100; scroll++) assert.equal(cache.getOrCreate('list', entry(1)), first);
  assert.equal(rasterized, 1);
  cache.getOrCreate('other', entry(1));
  cache.getOrCreate('third', entry(1));
  assert.equal(destroyed, 1);
  assert.equal(cache.bytes, 20);
  cache.dispose();
  assert.equal(destroyed, 3);
  assert.equal(cache.bytes, 0);
});

test('Presentation, GPU completion and CPU submission are separate measurements', async () => {
  let now = 100;
  const reports = [];
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  const metrics = new FrameMetrics({now: () => now, onMetrics: report => reports.push(report), refreshMs: 10});
  const frame = metrics.begin({inputTime: 95, backend: 'webgpu'});
  now = 102;
  metrics.submitted(frame, done);
  metrics.presented(frame, 110, {source: 'presentation-feedback'});
  assert.equal(reports.length, 0);
  now = 106;
  complete();
  await done;
  assert.equal(reports[0].submitMs, 2);
  assert.equal(reports[0].gpuDoneMs, 6);
  assert.equal(reports[0].inputToPresentMs, 15);
  const next = metrics.begin({inputTime: 118});
  metrics.submitted(next);
  metrics.presented(next, 140);
  await Promise.resolve();
  assert.equal(reports[1].droppedFrames, 2);
  assert.equal(reports[1].inputToPresentMs, null);
  assert.equal(reports[1].estimatedInputToPresentMs, 22);
  metrics.dispose();
});
