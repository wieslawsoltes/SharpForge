import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeActivity} from '../apps/studio/workers/runtime-activity.js';
import {compileProgram} from './a19-runtime-programs.js';
import {connectRuntimeWorker} from './a19-runtime-worker-client.js';

function browserTimers(t) {
  const pending = new Map();
  const cancelled = [];
  let serial = 0;
  let time = 0;
  t.mock.method(globalThis, 'setTimeout', function(callback, delay) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: worker timer receiver');
    const id = ++serial;
    pending.set(id, {callback, delay, due: time + delay});
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', function(id) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: worker timer receiver');
    cancelled.push(id);
    pending.delete(id);
  });
  return {
    pending, cancelled, clock: () => time,
    advance(milliseconds) {
      time += milliseconds;
    },
    fire(id) {
      const timer = pending.get(id);
      assert.ok(timer, 'the callback must belong to a pending timer');
      pending.delete(id);
      time = Math.max(time, timer.due);
      timer.callback();
    }
  };
}

function runtimeSession(timers) {
  const counts = {pumps: 0, frames: 0};
  const session = {
    vm: {
      state: 'running', scheduler: {nextDelay: () => 20},
      platform: {
        windows: new Set([1]), animations: {running: true},
        advanceAnimations() {
          counts.frames++;
          timers.advance(2);
        }
      }
    },
    pump(options) {
      assert.deepEqual(options, {instructionBudget: 15000, timeBudgetMs: 6});
      counts.pumps++;
      timers.advance(6);
      this.vm.state = 'waiting';
    }
  };
  return {session, counts};
}

test('runtime browser timers preserve sampling, pumping and animation ownership through replacement and stop', t => {
  const timers = browserTimers(t);
  const bareTimer = setTimeout(() => {}, 0);
  clearTimeout(bareTimer);
  const unrelated = {setTimer: globalThis.setTimeout, clearTimer: globalThis.clearTimeout};
  assert.throws(() => unrelated.setTimer(() => {}, 0), /Illegal invocation/);
  assert.throws(() => unrelated.clearTimer(bareTimer), /Illegal invocation/);
  let serial = 1;
  const errors = [];
  const published = [];
  const {session, counts} = runtimeSession(timers);
  const activity = new RuntimeActivity({getSession: () => session, getSerial: () => serial,
    clock: timers.clock, flush() {},
    publishState() {
      published.push(session.vm.state);
      activity.observeState();
    },
    onError: error => errors.push(error)});
  t.after(() => activity.stop());

  activity.start();
  activity.schedule();
  activity.observeState();
  const first = [activity.profileTimer, activity.pumpTimer, activity.animationTimer];
  assert.deepEqual(first.map(id => timers.pending.get(id).delay), [250, 0, 16]);
  timers.fire(activity.pumpTimer);
  assert.equal(counts.pumps, 1);
  assert.equal(timers.pending.get(activity.pumpTimer).delay, 20);
  timers.fire(activity.animationTimer);
  assert.equal(counts.frames, 1);
  assert.equal(timers.pending.get(activity.animationTimer).delay, 16);
  timers.fire(activity.profileTimer);
  assert.equal(activity.execution.read().samples[0].busyMs, 8);
  assert.equal(timers.pending.size, 3, 'all three timer roles rearm without duplicate callbacks');
  const retired = [...timers.pending.values()].map(timer => timer.callback);
  const animation = activity.animationTimer;
  session.vm.state = 'paused';
  activity.observeState();
  assert.equal(activity.animationTimer, null);
  assert.ok(timers.cancelled.includes(animation));

  serial++;
  session.vm.state = 'running';
  activity.start();
  activity.schedule();
  activity.observeState();
  const current = [activity.profileTimer, activity.pumpTimer, activity.animationTimer];
  for (const callback of retired) callback();
  assert.deepEqual([activity.profileTimer, activity.pumpTimer, activity.animationTimer], current);
  assert.equal(timers.pending.size, 3);
  assert.equal(activity.execution.read().sessionId, 2);
  assert.equal(counts.pumps, 1);
  assert.equal(counts.frames, 1);
  const stopped = [...timers.pending.values()].map(timer => timer.callback);
  activity.stop();
  for (const callback of stopped) callback();
  assert.equal(timers.pending.size, 0);
  assert.equal(activity.execution.active, false);
  assert.deepEqual(published, ['waiting']);
  assert.deepEqual(errors, []);
});

async function workerState(worker, sessionId, expected) {
  const state = await worker.wait(event => event.event === 'state' && event.sessionId === sessionId &&
    (event.state === expected || event.state === 'faulted'));
  assert.equal(state.state, expected, JSON.stringify(state.fault ?? state.reason));
  return state;
}

for (const managedIL of [false, true]) {
  test(`real ${managedIL ? 'CIL' : 'source'} worker reaches loaded and state with browser timer receivers`, async t => {
    const compiled = compileProgram('System.Console.WriteLine("timer receiver");', {includeDebug: true});
    const worker = connectRuntimeWorker(t, {url: new URL('./fixtures/a19/runtime-worker-timer-node.js', import.meta.url)});
    await worker.ready();
    const options = {assembly: compiled.assembly, managedIL, debug: true, stopOnEntry: true};
    const first = await worker.request('launch', options);
    assert.equal(first.started, true);
    assert.equal(first.sessionId, 1);
    const loaded = await worker.wait(event => event.event === 'loaded' && event.sessionId === first.sessionId);
    assert.ok(loaded.sources.length > 0);
    await workerState(worker, first.sessionId, 'paused');
    assert.equal((await worker.request('executionMetrics', {sessionId: first.sessionId})).active, true);
    await worker.request('resume', {sessionId: first.sessionId, mode: 'continue'});
    assert.equal((await workerState(worker, first.sessionId, 'terminated')).output, 'timer receiver\n');
    assert.equal((await worker.request('executionMetrics', {sessionId: first.sessionId})).active, false);

    const replacement = await worker.request('launch', options);
    assert.equal(replacement.sessionId, 2);
    await workerState(worker, replacement.sessionId, 'paused');
    await assert.rejects(worker.request('resume', {sessionId: first.sessionId, mode: 'continue'}), /session changed/);
    await worker.request('stop', {sessionId: replacement.sessionId});
    assert.equal((await worker.request('state', {sessionId: replacement.sessionId})).state, 'terminated');
    assert.equal((await worker.request('executionMetrics', {sessionId: replacement.sessionId})).active, false);
  });
}
