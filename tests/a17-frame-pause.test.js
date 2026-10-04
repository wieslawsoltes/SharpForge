import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameScheduler} from '@sharpforge/rendering';

test('debug pause freezes animation callbacks, permits layout/paint and excludes paused wall time', () => {
  const frames = new Map();
  let serial = 0;
  const scheduler = new FrameScheduler({requestFrame: callback => { frames.set(++serial, callback); return serial; },
    cancelFrame: id => frames.delete(id)});
  const deltas = [];
  const phases = [];
  scheduler.register('animation', 'clock', frame => deltas.push(frame.delta));
  scheduler.register('layout', 'host', () => phases.push('layout'));
  scheduler.register('build', 'paint', () => phases.push('paint'));
  scheduler.setContinuous('clock', true);
  scheduler.flush(0);
  scheduler.flush(10);
  scheduler.setPaused(true);
  scheduler.invalidate('layout');
  scheduler.flush(5000);
  assert.deepEqual(deltas, [0, 10]);
  assert.deepEqual(phases.slice(-2), ['layout', 'paint']);
  assert.equal(frames.size, 0);
  scheduler.setPaused(false);
  scheduler.flush(10000);
  scheduler.flush(10010);
  assert.deepEqual(deltas, [0, 10, 0, 10]);
  assert.throws(() => scheduler.setPaused(1), /boolean/);
  scheduler.dispose();
  assert.equal(frames.size, 0);
});


test('later-phase invalidation is consumed in the same frame and does not create idle RAF traffic', () => {
  const frames = new Map();
  let serial = 0, builds = 0;
  const scheduler = new FrameScheduler({requestFrame: callback => { frames.set(++serial, callback); return serial; },
    cancelFrame: id => frames.delete(id)});
  scheduler.register('animation', 'state', () => scheduler.invalidate('build'));
  scheduler.register('build', 'paint', () => builds++);
  scheduler.invalidate('animation');
  scheduler.flush(0);
  assert.equal(builds, 1);
  assert.equal(frames.size, 0);
  scheduler.dispose();
});
