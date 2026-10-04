import test from 'node:test';
import assert from 'node:assert/strict';
import {ContextCompletions} from '../packages/runtime/src/execution/context-completions.js';

function fixture(maximum = 4096) {
  const scheduler = {contexts: new Map([[1, {id: 1, status: 'ready'}], [2, {id: 2, status: 'waiting'}]])};
  return {scheduler, completions: new ContextCompletions(scheduler, {maximum})};
}

test('context observers wait through suspension and receive completion once without retaining completed contexts', async () => {
  const {scheduler, completions} = fixture();
  let settled = false;
  const result = completions.wait(1).then(value => { settled = true; return value; });
  scheduler.contexts.get(1).status = 'waiting';
  completions.complete(scheduler.contexts.get(1));
  await Promise.resolve();
  assert.equal(settled, false);
  scheduler.contexts.get(1).status = 'completed';
  completions.complete(scheduler.contexts.get(1));
  completions.complete(scheduler.contexts.get(1));
  assert.deepEqual(await result, {id: 1, status: 'completed'});
  assert.equal(completions.count, 0);
  assert.equal(completions.waiters.size, 0);
  assert.deepEqual(await completions.wait(1), {id: 1, status: 'completed'});
});

test('context observers preserve faults and reject cancellation, unknown identities, and bounds', async () => {
  const {scheduler, completions} = fixture(1);
  const failed = completions.wait(1);
  await assert.rejects(completions.wait(2), /observer limit/);
  const fault = new Error('managed handler failed');
  Object.assign(scheduler.contexts.get(1), {status: 'faulted', fault});
  completions.complete(scheduler.contexts.get(1));
  await assert.rejects(failed, error => error === fault);
  await assert.rejects(completions.wait(1), error => error === fault);
  await assert.rejects(completions.wait(99), /Unknown managed/);
  scheduler.contexts.get(2).status = 'canceled';
  await assert.rejects(completions.wait(2), /canceled/);
  assert.throws(() => fixture(0), /Invalid context/);
});

test('abort and rewind remove native observers while leaving managed execution ownership with the scheduler', async () => {
  const {scheduler, completions} = fixture();
  const controller = new AbortController();
  const aborted = completions.wait(1, {signal: controller.signal});
  controller.abort(new Error('request superseded'));
  await assert.rejects(aborted, /superseded/);
  assert.equal(scheduler.contexts.get(1).status, 'ready');
  assert.equal(completions.count, 0);
  const first = completions.wait(1), second = completions.wait(2);
  completions.cancelAll('Managed execution was rewound');
  await assert.rejects(first, /rewound/);
  await assert.rejects(second, /rewound/);
  assert.equal(completions.count, 0);
  assert.equal(completions.waiters.size, 0);
  await assert.rejects(completions.wait(1, {signal: controller.signal}), /superseded/);
});
