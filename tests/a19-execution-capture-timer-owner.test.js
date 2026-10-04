import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionCapture} from '../apps/studio/workbench/tools/execution-capture.js';
import {DiagnosticTimeline} from '../apps/studio/workbench/tools/diagnostic-timeline-model.js';
import {SessionManager} from '../apps/studio/workbench/session-manager.js';
import {executionMetric} from '../apps/studio/workers/execution-occupancy.js';
import {fakeWorkers, settle} from './a19-session-fixtures.js';

function browserTimers(t) {
  const pending = new Map();
  const cancelled = [];
  let nextId = 0;
  t.mock.method(globalThis, 'setTimeout', function(callback, delay) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: browser timer receiver');
    const id = ++nextId;
    pending.set(id, {callback, delay});
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', function(id) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: browser timer receiver');
    cancelled.push(id);
    pending.delete(id);
  });
  return {
    pending, cancelled,
    fire() {
      const [id, timer] = pending.entries().next().value;
      pending.delete(id);
      timer.callback();
      return id;
    }
  };
}

test('runtime UI events preserve the browser timer receiver through capture wake, pause and disposal', t => {
  const timers = browserTimers(t);
  const {workers, factory} = fakeWorkers();
  const sessions = new SessionManager({workerFactory: factory});
  const model = new DiagnosticTimeline({clock: () => 100});
  const session = sessions.create({id: 'app', projectId: 'App'});
  const capture = new ExecutionCapture({sessions, model, clock: () => 100});
  t.after(() => { capture.dispose(); sessions.dispose(); model.dispose(); });
  capture.start();
  assert.equal(timers.pending.size, 0, 'the initial session has no runtime serial yet');
  const delivered = [];
  sessions.subscribe(event => { if (event.type === 'ui') delivered.push(event); });

  assert.doesNotThrow(() => workers[0].emit({event: 'ui', sessionId: 1, commands: []}));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].session, session);
  assert.equal(timers.pending.size, 1);
  workers[0].emit({event: 'ui', sessionId: 1, commands: []});
  assert.equal(timers.pending.size, 1, 'serial polling retains a single wake timer');
  capture.setPaused(true);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cancelled, [1]);
  capture.setPaused(false);
  assert.equal(timers.pending.size, 1);
  capture.dispose();
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cancelled, [1, 2]);
  workers[0].emit({event: 'ui', sessionId: 1, commands: []});
  assert.equal(timers.pending.size, 0, 'disposal removes the event-driven wake subscription');
  assert.equal(delivered.length, 3);
});

test('default browser timers rearm bounded polling after completion and cancel the next wake', async t => {
  const timers = browserTimers(t);
  let requests = 0;
  const session = {
    id: 'app', projectId: 'App', name: 'App', identity: 'app:1:1', runtimeSession: 1,
    live: true, worker: {generation: 1},
    request: async () => {
      requests++;
      return {metric: executionMetric, sessionId: 1, intervalMs: 250, active: true,
        sequence: 0, firstSequence: 1, truncated: false, totalBusyMs: 0, samples: []};
    }
  };
  const sessions = {list: () => [session], subscribe: () => () => {}};
  const model = new DiagnosticTimeline({clock: () => 100});
  const errors = [];
  const capture = new ExecutionCapture({sessions, model, intervalMs: 500, clock: () => 100,
    onError: error => errors.push(error)});
  t.after(() => { capture.dispose(); model.dispose(); });
  capture.start();
  assert.equal(timers.pending.get(1).delay, 0);
  timers.fire();
  await settle();
  assert.equal(requests, 1);
  assert.equal(capture.running, false);
  assert.equal(timers.pending.size, 1);
  assert.equal(timers.pending.get(2).delay, 500);
  timers.fire();
  await settle();
  assert.equal(requests, 2);
  assert.equal(timers.pending.size, 1);
  capture.setPaused(true);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(timers.cancelled, [3]);
  assert.deepEqual(errors, []);
});
