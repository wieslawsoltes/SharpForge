import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeActivity } from '../apps/studio/workers/runtime-activity.js';
import { ExecutionCapture } from '../apps/studio/workbench/tools/execution-capture.js';
import { DiagnosticTimeline } from '../apps/studio/workbench/tools/diagnostic-timeline-model.js';
import { WorkbenchEvents } from '../apps/studio/workbench/state-events.js';
import { browserGlobalTimers } from './support/browser-global-timers.js';

function timerBoundary(context) {
  const pending = new Map();
  let serial = 0;
  const checked = browserGlobalTimers(globalThis, {
    schedule(callback, milliseconds) {
      pending.set(++serial, { callback, milliseconds });
      return serial;
    },
    cancel: handle => pending.delete(handle)
  });
  context.mock.method(globalThis, 'setTimeout', checked.setTimeout);
  context.mock.method(globalThis, 'clearTimeout', checked.clearTimeout);
  return pending;
}

test('default runtime timers schedule and cancel pump, animation and occupancy work on their global owner', context => {
  const pending = timerBoundary(context);
  const session = { vm: { state: 'running', platform: { windows: new Set([1]), animations: { running: true } } } };
  const activity = new RuntimeActivity({ getSession: () => session, getSerial: () => 1,
    clock: () => 0, flush() {}, publishState() {}, onError: error => { throw error; } });
  context.after(() => activity.stop());
  activity.start();
  activity.schedule();
  activity.scheduleAnimations();
  assert.deepEqual([...pending.values()].map(timer => timer.milliseconds), [250, 0, 16]);
  assert.equal(new Set([activity.profileTimer, activity.pumpTimer, activity.animationTimer]).size, 3);
  activity.stop();
  assert.equal(pending.size, 0);
  assert.equal(activity.started, false);
  assert.equal(activity.execution.active, false);
  activity.schedule();
  assert.equal(pending.size, 0, 'A stopped owner cannot resume its pump');
});

test('default capture timers tolerate the first runtime UI event and preserve pause, resume and disposal', context => {
  const pending = timerBoundary(context);
  const events = new WorkbenchEvents();
  const session = { id: 'app', identity: 'app:1:0', runtimeSession: null, disposed: false, live: true };
  const sessions = { list: () => [session], subscribe: listener => events.subscribe(listener) };
  const model = new DiagnosticTimeline({ clock: () => 0 });
  const capture = new ExecutionCapture({ sessions, model });
  context.after(() => { capture.dispose(); model.dispose(); events.dispose(); });
  capture.start();
  assert.equal(pending.size, 0);
  session.identity = 'app:1:1';
  session.runtimeSession = 1;
  events.emit({ type: 'ui', session, commands: [{ op: 'reset' }] });
  const first = capture.timer;
  assert.ok(pending.has(first));
  events.emit({ type: 'state', session });
  assert.equal(capture.timer, first, 'Repeated launch events do not enqueue another poll');
  capture.setPaused(true);
  assert.equal(pending.size, 0);
  capture.setPaused(false);
  assert.ok(pending.has(capture.timer));
  assert.notEqual(capture.timer, first);
  capture.dispose();
  assert.equal(pending.size, 0);
  assert.equal(events.listeners.size, 0);
  events.emit({ type: 'ui', session, commands: [{ op: 'reset' }] });
  assert.equal(pending.size, 0);
});

test('injected runtime scheduler callbacks retain their existing owner receiver', () => {
  let activity;
  const calls = [];
  const setTimer = function(callback, milliseconds) {
    assert.equal(this, activity);
    calls.push(['set', milliseconds]);
    return 7;
  };
  const clearTimer = function(handle) {
    assert.equal(this, activity);
    calls.push(['clear', handle]);
  };
  activity = new RuntimeActivity({ getSession: () => ({ vm: { state: 'paused' } }), getSerial: () => 1,
    setTimer, clearTimer, clock: () => 0, flush() {}, publishState() {}, onError: error => { throw error; } });
  assert.equal(activity.setTimer, setTimer);
  assert.equal(activity.clearTimer, clearTimer);
  activity.start();
  activity.stop();
  assert.deepEqual(calls, [['set', 250], ['clear', 7]]);
});
