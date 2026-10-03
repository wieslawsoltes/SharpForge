import test from 'node:test';
import assert from 'node:assert/strict';
import {SafepointCoordinator, SafepointKind} from '../packages/runtime/src/gc/safepoints.js';

test('collection waits for every context and invokes tier deoptimization before root publication', () => {
  const coordinator = new SafepointCoordinator({});
  const calls = [];
  coordinator.register('parked', {
    deopt: kind => calls.push(`parked deopt ${kind}`),
    publishRoots: kind => calls.push(`parked roots ${kind}`)
  });
  coordinator.register('running', {
    parked: false,
    deopt: kind => calls.push(`running deopt ${kind}`),
    publishRoots: kind => calls.push(`running roots ${kind}`)
  });
  const ticket = coordinator.request({reason: 'Test'});
  assert.equal(ticket.state, 'requested');
  assert.deepEqual(ticket.pending, ['running']);
  assert.throws(() => coordinator.assertStopped(ticket), {name: 'InvalidOperationException'});
  coordinator.poll('running', SafepointKind.BackEdge);
  assert.equal(ticket.state, 'stopped');
  assert.strictEqual(coordinator.assertStopped(ticket), ticket);
  assert.deepEqual(calls, [
    'parked deopt slice-boundary', 'parked roots slice-boundary', 'running deopt back-edge', 'running roots back-edge'
  ]);
  coordinator.poll('running', SafepointKind.Call);
  assert.equal(calls.length, 4, 'each tier deoptimizes once per suspension');
  assert.throws(() => coordinator.leave('running'), {name: 'InvalidOperationException'});
  coordinator.resume(ticket);
  assert.doesNotThrow(() => coordinator.leave('running'));
});

test('synchronous collection refuses an unregistered point and resumes after callback failure', () => {
  const coordinator = new SafepointCoordinator({});
  coordinator.register('vm', {parked: false});
  let invoked = false;
  assert.throws(() => coordinator.withSuspension(() => { invoked = true; }), {name: 'InvalidOperationException'});
  assert.equal(invoked, false);
  assert.equal(coordinator.suspension, null);
  assert.throws(() => coordinator.poll('vm', 'guessed-safe'), /Unregistered safepoint/);
  coordinator.poll('vm', SafepointKind.Allocation);
  const original = new Error('Collection failure');
  assert.throws(() => coordinator.withSuspension(() => { throw original; }), error => error === original);
  assert.equal(coordinator.suspension, null);
});

test('nested stop scopes, empty heaps and restored context identities preserve handshake invariants', () => {
  const coordinator = new SafepointCoordinator({});
  assert.equal(coordinator.withSuspension(() => coordinator.withSuspension(() => 7)), 7);
  const lease = coordinator.register(1);
  const snapshot = coordinator.snapshot();
  lease.dispose();
  coordinator.restore(snapshot);
  assert.equal(coordinator.contexts.size, 1);
  assert.equal(coordinator.withSuspension(() => 11), 11);
  assert.throws(() => coordinator.register(1), /unique/);
  assert.throws(() => coordinator.resume({epoch: -1}), /Invalid GC resume ticket/);
});
