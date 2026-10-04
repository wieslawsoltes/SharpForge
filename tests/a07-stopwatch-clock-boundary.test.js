import test from 'node:test';
import assert from 'node:assert/strict';
import {stopwatchPlatform} from './fixtures/stopwatch.js';

function executionState(watch) {
  const {vm, platform, reference} = watch;
  const record = platform.record(reference);
  return {record, data: [...record.data], frames: vm.frames, state: vm.state,
    pins: [...platform.heap.pins], writes: vm.writeRevision, heapRevision: platform.heap.mutationRevision,
    previous: platform.stopwatchClockState.previous};
}

function assertUnchanged(before, after) {
  assert.equal(after.record, before.record, 'A rejected restore must not replace the managed record');
  assert.deepEqual(after.data, before.data, 'A rejected restore must not overwrite Stopwatch fields');
  assert.equal(after.frames, before.frames, 'A rejected restore must not replace the active frames');
  assert.equal(after.state, before.state);
  assert.deepEqual(after.pins, before.pins, 'The active BCL receiver must remain rooted');
  assert.equal(after.writes, before.writes);
  assert.equal(after.heapRevision, before.heapRevision);
  assert.equal(after.previous, before.previous);
}

function clockBoundary(engine, action, operation) {
  let now = 1000n, attempt = false, saved, observation;
  const writes = [];
  const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
    if (attempt) {
      observation = {before: executionState(watch)};
      try {
        observation.result = action === 'snapshot' ? watch.vm.snapshot() : watch.vm.restore(saved);
      } catch (error) { observation.error = error; }
      observation.after = executionState(watch);
    }
    return now;
  }});
  const {vm, platform, call, staticCall, reference} = watch;
  try {
    call('Start'); now = 1100n; call('Stop');
    assert.equal(call('get_ElapsedTicks'), 100n);
    saved = vm.snapshot();
    now = 2000n; call('Restart');
    assert.deepEqual(platform.record(reference).data, ['$elapsed', 0n, '$started', 2000n, '$running', true]);
    vm.onWrite = write => writes.push([write.property, write.oldValue, write.value]);
    attempt = true; now = 2200n;
    const result = operation === 'Stop' ? call('Stop') : staticCall('GetTimestamp');
    assert.equal(result, operation === 'Stop' ? null : 2200n, 'The caught boundary error does not poison a valid clock sample');
    assert(observation);
    assert.equal(observation.error?.name, 'TypeError', `${action} during an active clock callback must be rejected`);
    assert.match(observation.error.message, /callback/i);
    assert.equal(observation.result, undefined, 'No execution snapshot may escape an unfinished host callback');
    assertUnchanged(observation.before, observation.after);
    const stopped = operation === 'Stop';
    assert.deepEqual(platform.record(reference).data, ['$elapsed', stopped ? 200n : 0n,
      '$started', 2000n, '$running', !stopped]);
    assert.deepEqual(writes, stopped ? [['$elapsed', 0n, 200n], ['$running', true, false]] : [],
      'The continuation must not write using a record replaced by the callback');
    assert.equal(platform.stopwatchClockState.previous, 2200n);
    assert.equal(platform.stopwatchClockState.reading, false);
    assert.equal(platform.stopwatchClockState.reference, null);
    assert.equal(platform.stopwatchClockState.reentered, false);
    assert.equal(platform.synchronousHostCallbackDepth, 0);
    assert.equal(platform.heap.pins.length, 0);
    attempt = false;
    const betweenCalls = vm.snapshot();
    assert(betweenCalls);
    vm.restore(saved);
    assert.equal(call('get_ElapsedTicks'), 100n, 'Between-call restore retains the saved managed state');
    assert.equal(platform.stopwatchClockState.previous, 2200n, 'Host clock history does not rewind');
    now = 2100n;
    assert.throws(() => call('Start'), error => error.name === 'InvalidOperationException' && /BCLSW0005/.test(error.message));
    assert.equal(call('get_ElapsedTicks'), 100n);
    assert.equal(platform.heap.pins.length, 0);
  } finally { vm.onWrite = null; watch.stop(); }
}

function clockExit(engine, exit) {
  let now = 1000n, interrupt = false, receiver, nested;
  const watch = stopwatchPlatform(engine, {stopwatchClock: function () {
    receiver = this;
    if (!interrupt) return now;
    if (exit === 'throw') throw new Error('Clock callback failed');
    if (exit === 'reentry') {
      try { watch.staticCall('GetTimestamp'); } catch (error) { nested = error; }
    } else {
      watch.vm.stop();
      if (exit === 'stop-and-throw') throw new Error('Clock stopped before failing');
    }
    return now;
  }});
  const {vm, platform, call, reference} = watch;
  try {
    call('Start');
    const saved = vm.snapshot();
    const data = [...platform.record(reference).data];
    interrupt = true;
    now = 1100n;
    if (exit.startsWith('stop')) assert.equal(call('Stop'), null);
    else {
      const code = exit === 'throw' ? 'BCLSW0003' : 'BCLSW0006';
      assert.throws(() => call('Stop'), error => error.name === 'InvalidOperationException' && error.message.startsWith(code + ':'));
    }
    if (exit === 'reentry') assert.match(nested.message, /BCLSW0006/);
    assert.equal(receiver, platform.stopwatchClockState, 'The host clock retains its existing receiver');
    assert.deepEqual(platform.record(reference).data, data);
    assert.equal(platform.stopwatchClockState.previous, 1000n);
    assert.equal(platform.stopwatchClockState.reading, false);
    assert.equal(platform.stopwatchClockState.reference, null);
    assert.equal(platform.stopwatchClockState.reentered, exit === 'reentry');
    assert.equal(platform.synchronousHostCallbackDepth, 0);
    assert.equal(platform.heap.pins.length, 0);
    assert.equal(vm.fault, null);
    assert.equal(vm.pendingFault, null);
    assert.doesNotThrow(() => vm.snapshot());
    vm.restore(saved);
    interrupt = false;
    call('Stop');
    assert.equal(call('get_ElapsedTicks'), 100n);
    assert.equal(platform.stopwatchClockState.previous, 1100n);
    assert.equal(platform.synchronousHostCallbackDepth, 0);
    assert.equal(platform.heap.pins.length, 0);
  } finally { watch.stop(); }
}

for (const engine of ['source', 'cil']) {
  for (const action of ['snapshot', 'restore']) {
    for (const operation of ['Stop', 'GetTimestamp']) {
      test(`Stopwatch clock boundary ${engine}/${operation}: a caught ${action} rejection preserves the live continuation`, () => {
        clockBoundary(engine, action, operation);
      });
    }
  }
  test(`Stopwatch clock boundary ${engine}: callback failure, reentry and explicit stop release the boundary`, () => {
    for (const exit of ['throw', 'reentry', 'stop-and-return', 'stop-and-throw']) clockExit(engine, exit);
  });
}
