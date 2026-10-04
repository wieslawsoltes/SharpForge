import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionOccupancy, executionMetric} from '../apps/studio/workers/execution-occupancy.js';
import {RuntimeActivity} from '../apps/studio/workers/runtime-activity.js';

function fixture() {
  let time = 0, serial = 0;
  const timers = new Map();
  return {
    clock: () => time,
    advance: milliseconds => { time += milliseconds; },
    timers,
    setTimer: (callback, delay) => {
      const id = ++serial;
      timers.set(id, {callback, due: time + delay});
      return id;
    },
    clearTimer: id => timers.delete(id),
    run: id => {
      const timer = timers.get(id);
      assert.ok(timer, 'timer must be scheduled');
      timers.delete(id);
      time = Math.max(time, timer.due);
      timer.callback();
    }
  };
}

test('execution occupancy measures actual intervals and separate synchronous categories', () => {
  const time = fixture(), profile = new ExecutionOccupancy({clock: time.clock});
  profile.reset(1);
  assert.equal(profile.measure('managed', () => { time.advance(25); return 'result'; }), 'result');
  time.advance(225);
  assert.deepEqual(profile.sample(), {metric: executionMetric, sessionId: 1, sequence: 1,
    startMs: 0, endMs: 250, durationMs: 250, busyMs: 25, occupancyPercent: 10, managedMs: 25, uiMs: 0, debuggerMs: 0});
  time.advance(250);
  assert.equal(profile.sample().busyMs, 0);
  profile.measure('ui', () => time.advance(20));
  profile.measure('debugger', () => time.advance(5));
  time.advance(375);
  const sample = profile.sample();
  assert.equal(sample.durationMs, 400);
  assert.equal(sample.occupancyPercent, 6.25);
  assert.equal(sample.uiMs, 20);
  assert.equal(sample.debuggerMs, 5);
  assert.equal(profile.read().totalBusyMs, 50);
});

test('nested work counts once and a close inside the operation includes its complete final interval', () => {
  const time = fixture(), profile = new ExecutionOccupancy({clock: time.clock});
  profile.reset(1);
  profile.measure('managed', () => {
    time.advance(10);
    profile.measure('ui', () => time.advance(5));
    profile.close();
    time.advance(2);
  });
  const batch = profile.read();
  assert.equal(batch.active, false);
  assert.equal(batch.samples.length, 1);
  assert.equal(batch.samples[0].durationMs, 17);
  assert.equal(batch.samples[0].managedMs, 17);
  assert.equal(batch.samples[0].uiMs, 0);
  time.advance(1000);
  assert.deepEqual(profile.read(), batch, 'post-exit idle time must not dilute the final interval');
});

test('measurement preserves synchronous exceptions and rejects asynchronous waiting', () => {
  const time = fixture(), profile = new ExecutionOccupancy({clock: time.clock});
  profile.reset(1);
  const expected = new Error('managed failure');
  assert.throws(() => profile.measure('managed', () => { time.advance(4); throw expected; }), error => error === expected);
  assert.throws(() => profile.measure('ui', () => Promise.resolve()), {code: 'PROFILE_ASYNC_OPERATION'});
  time.advance(1);
  profile.close();
  assert.equal(profile.read().totalBusyMs, 4);
  assert.equal(profile.measure('managed', () => 42), 42, 'closed measurement does not change dispatch results');
});

test('bounded sequence windows report lost history and replacement clears the previous launch', () => {
  const time = fixture(), profile = new ExecutionOccupancy({clock: time.clock, intervalMs: 50, limit: 2});
  profile.reset(8);
  for (let index = 0; index < 4; index++) {
    profile.measure('managed', () => time.advance(5));
    time.advance(45);
    profile.sample();
  }
  assert.deepEqual(profile.read().samples.map(sample => sample.sequence), [3, 4]);
  assert.equal(profile.read().truncated, true);
  assert.equal(profile.read().firstSequence, 3);
  assert.equal(profile.read({after: 3, limit: 1}).samples[0].sequence, 4);
  assert.throws(() => profile.read({after: 5}), {code: 'PROFILE_CURSOR_RANGE'});
  profile.reset(9);
  assert.equal(profile.read().sessionId, 9);
  assert.equal(profile.read().sequence, 0);
  assert.equal(profile.read().totalBusyMs, 0);
});

test('occupancy validates bounds, clock monotonicity and replacement outside measured work', () => {
  for (const intervalMs of [0, 49, 5001, NaN]) assert.throws(() => new ExecutionOccupancy({intervalMs}), RangeError);
  for (const limit of [0, 10_001, 1.5]) assert.throws(() => new ExecutionOccupancy({limit}), RangeError);
  const time = fixture(), profile = new ExecutionOccupancy({clock: time.clock});
  assert.throws(() => profile.reset(0), RangeError);
  profile.reset(1);
  assert.throws(() => profile.measure('missing', () => {}), TypeError);
  assert.throws(() => profile.measure('managed', () => profile.reset(2)), {code: 'PROFILE_BUSY'});
  assert.throws(() => profile.read({limit: 2001}), RangeError);
  assert.throws(() => profile.read({after: -1}), RangeError);
  time.advance(-1);
  assert.throws(() => profile.read(), {code: 'PROFILE_CLOCK'});
});

function runtimeFixture({state = 'running', windows = false, manualAnimations = false} = {}) {
  const time = fixture();
  let serial = 1, pumps = 0, animationFrames = 0;
  const errors = [], published = [];
  const session = {vm: {state, scheduler: {nextDelay: () => 20}, platform: {
    windows: new Set(windows ? [1] : []), animations: {running: windows, clear() { this.running = false; }},
    advanceAnimations() { animationFrames++; time.advance(2); }
  }}, pump() { pumps++; time.advance(6); this.vm.state = 'terminated'; }, pause() { this.vm.state = 'paused'; }};
  const activity = new RuntimeActivity({...time, getSession: () => session, getSerial: () => serial, flush() {},
    publishState() { published.push(session.vm.state); activity.observeState(); }, onError: error => errors.push(error)});
  activity.start({manualAnimations});
  return {time, session, activity, errors, published, replace: () => { serial++; activity.start(); },
    pumps: () => pumps, animationFrames: () => animationFrames};
}

test('runtime pumping closes the actual final interval and cancels idle sampling after termination', () => {
  const {time, activity, pumps, published} = runtimeFixture();
  activity.schedule();
  time.run(activity.pumpTimer);
  const result = activity.execution.read();
  assert.equal(pumps(), 1);
  assert.deepEqual(published, ['terminated']);
  assert.equal(result.samples[0].managedMs, 6);
  assert.equal(result.samples[0].durationMs, 6);
  assert.equal(result.active, false);
  assert.equal(time.timers.size, 0);
});

test('paused runtimes sample genuine idle intervals and freeze automatic animations', () => {
  const {time, activity, session, animationFrames} = runtimeFixture({windows: true});
  activity.scheduleAnimations();
  time.run(activity.animationTimer);
  assert.equal(animationFrames(), 1);
  session.vm.state = 'paused';
  activity.observeState();
  assert.equal(activity.animationTimer, null);
  time.run(activity.profileTimer);
  assert.equal(activity.execution.read().samples[0].uiMs, 2);
  time.run(activity.profileTimer);
  assert.equal(activity.execution.read().samples.at(-1).busyMs, 0);
  activity.stop();
  assert.equal(time.timers.size, 0);
});

test('retired launch timer callbacks cannot clear or execute replacement timers', () => {
  const {time, activity, replace, pumps, animationFrames} = runtimeFixture({windows: true});
  activity.schedule();
  activity.scheduleAnimations();
  const oldCallbacks = [...time.timers.values()].map(timer => timer.callback);
  replace();
  activity.schedule();
  activity.scheduleAnimations();
  const current = [activity.pumpTimer, activity.animationTimer, activity.profileTimer];
  for (const callback of oldCallbacks) callback();
  assert.deepEqual([activity.pumpTimer, activity.animationTimer, activity.profileTimer], current);
  assert.equal(pumps(), 0);
  assert.equal(animationFrames(), 0);
  assert.equal(activity.execution.read().sessionId, 2);
  activity.stop();
});

test('request measurements exclude inspection and count UI/debug actions without changing their results', () => {
  const {time, activity, session} = runtimeFixture({state: 'paused', windows: true, manualAnimations: true});
  activity.observeState();
  assert.equal(activity.animationTimer, null);
  const dispatch = (method, params) => { time.advance(params.duration); return method; };
  assert.equal(activity.dispatch('heapCensus', {duration: 10}, dispatch), 'heapCensus');
  activity.dispatch('uiLayout', {duration: 3}, dispatch);
  activity.dispatch('evaluateFunction', {duration: 4}, dispatch);
  session.vm.platform.windows.clear();
  session.vm.state = 'terminated';
  activity.observeState();
  const sample = activity.execution.read().samples[0];
  assert.equal(sample.busyMs, 7);
  assert.equal(sample.durationMs, 17);
  assert.equal(sample.uiMs, 3);
  assert.equal(sample.debuggerMs, 4);
  activity.stop();
});

test('runtime pump failures keep a paused capture and report the original error', () => {
  const {time, activity, session, errors} = runtimeFixture();
  const failure = new Error('runtime fault');
  session.pump = () => { time.advance(3); throw failure; };
  activity.schedule();
  time.run(activity.pumpTimer);
  assert.equal(session.vm.state, 'paused');
  assert.deepEqual(errors, [failure]);
  assert.equal(activity.execution.active, true);
  activity.stop();
  assert.equal(activity.execution.read().samples[0].managedMs, 3);
});
