import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeActivity} from '../apps/studio/workers/runtime-activity.js';

function fixture(context) {
  let time = 0, nextTimer = 0;
  const timers = new Map();
  const session = {vm: {state: 'waiting', platform: {windows: new Set([1]), animations: {running: false}}}};
  const activity = new RuntimeActivity({getSession: () => session, getSerial: () => 1, flush() {}, publishState() {}, onError() {},
    clock: () => time, setTimer: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimer: id => timers.delete(id)});
  activity.start();
  context.after(() => activity.stop());
  return {activity, advance: milliseconds => { time += milliseconds; }};
}

test('new UI feedback operations retain values and synchronous failure identity in occupancy dispatch', context => {
  const {activity, advance} = fixture(context);
  assert.equal(activity.dispatch('uiPrivateInput', {}, () => { advance(2); return true; }), true);
  assert.equal(activity.dispatch('uiHostResponse', {}, () => { advance(3); return 4; }), 4);
  const expected = new Error('managed callback failed');
  assert.throws(() => activity.dispatch('uiAutomationAction', {}, () => { advance(5); throw expected; }), error => error === expected);
  advance(240);
  const sample = activity.execution.sample();
  assert.equal(sample.uiMs, 10);
  assert.equal(sample.busyMs, 10);
  assert.equal(sample.debuggerMs, 0);
});
