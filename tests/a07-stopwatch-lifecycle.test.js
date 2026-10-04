import test from 'node:test';
import assert from 'node:assert/strict';
import {findContracts} from '@sharpforge/framework';
import {stopwatchPlatform, stopwatchContract} from './fixtures/stopwatch.js';

function completeMain(vm) {
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.fault, null);
  assert.equal(result.output, '');
  assert.equal(vm.frames.length, 0);
  assert.equal(vm.platform.hostOperations.closed, false, 'Natural completion does not dispose the platform');
}

function virtualText(platform, reference, expected) {
  const result = platform.bclHost.invokeObjectToString(platform, reference);
  assert.equal(result.handled, true);
  assert.notEqual(result.canceled, true, 'An available platform must return the virtual string result');
  assert.equal(platform.native(result.value), expected);
}

function constructor(platform, owner, text) {
  const descriptor = findContracts(owner, '.ctor').find(member => member.parameters.join(',') === 'string');
  assert(descriptor, owner);
  return platform.invoke(descriptor, [platform.managed(text, 'string')]);
}

function stopAfterCompletion(engine, operation, exit) {
  let cancel = false, observed;
  const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
    if (!cancel) return 1000n;
    const beforeState = watch.vm.state, beforeClosed = watch.platform.hostOperations.closed;
    const data = [...watch.platform.record(watch.reference).data];
    watch.vm.stop();
    observed = {beforeState, beforeClosed, data, allocations: watch.platform.heap.stats.allocations,
      bytes: watch.platform.heap.stats.allocatedBytes, writes: watch.vm.writeRevision};
    if (exit === 'throw') throw new Error('Clock stopped an already completed VM');
    return -1n;
  }});
  try {
    watch.call('Start'); completeMain(watch.vm);
    cancel = true;
    const result = operation === 'Object.ToString'
      ? watch.platform.bclHost.invokeObjectToString(watch.platform, watch.reference) : watch.call(operation);
    assert(observed);
    assert.deepEqual(result, operation === 'Object.ToString' ? {handled: true, value: null, canceled: true} : null);
    assert.equal(observed.beforeState, 'terminated');
    assert.equal(observed.beforeClosed, false);
    assert.equal(watch.vm.state, 'terminated');
    assert.equal(watch.platform.hostOperations.closed, true, 'Explicit stop is distinguishable even when state stays terminated');
    assert.equal(watch.vm.fault, null);
    assert.equal(watch.vm.pendingFault, null);
    assert.deepEqual(watch.platform.record(watch.reference).data, observed.data);
    assert.equal(watch.platform.heap.stats.allocations, observed.allocations);
    assert.equal(watch.platform.heap.stats.allocatedBytes, observed.bytes);
    assert.equal(watch.vm.writeRevision, observed.writes);
    assert.equal(watch.platform.stopwatchClockState.previous, 1000n);
    assert.equal(watch.platform.stopwatchClockState.reading, false);
    assert.equal(watch.platform.stopwatchClockState.reference, null);
    assert.equal(watch.platform.heap.pins.length, 0);
    assert.equal(watch.vm.run().output, '');
  } finally { watch.stop(); }
}

for (const engine of ['source', 'cil']) {
  test(`Stopwatch lifecycle ${engine}: natural Main completion retains clock reads, transitions and construction`, () => {
    let now = 1000n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const {call, staticCall, span, platform, vm} = watch;
    try {
      call('Start'); completeMain(vm);
      now += 1_500_000_000n;
      assert.equal(call('get_ElapsedMilliseconds'), 1500n);
      assert.equal(call('get_ElapsedTicks'), 1_500_000_000n);
      assert.equal(span(call('get_Elapsed')), 1500);
      assert.equal(platform.native(call('ToString')), '00:00:01.5000000');
      virtualText(platform, watch.reference, '00:00:01.5000000');
      assert.equal(staticCall('GetTimestamp'), now);
      assert.equal(span(staticCall('GetElapsedTime', ['long'], [1000n])), 1500);
      call('Stop');
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), false);
      call('Start'); now += 100n;
      assert.equal(call('get_ElapsedTicks'), 1_500_000_100n);
      call('Restart'); now += 100n;
      assert.equal(call('get_ElapsedTicks'), 100n);
      call('Reset');
      assert.equal(call('get_ElapsedTicks'), 0n);
      const fresh = staticCall('StartNew');
      assert.equal(Boolean(platform.native(platform.invoke(stopwatchContract('get_IsRunning'), [fresh]))), true);
      assert.equal(platform.invoke(stopwatchContract('get_ElapsedTicks'), [fresh]), 0n);
      assert.equal(platform.stopwatchClockState.previous, now);
      assert.equal(platform.heap.pins.length, 0);
      assert.equal(vm.state, 'terminated');
      assert.equal(platform.hostOperations.closed, false);
      assert.equal(vm.allFrames().length, 0);
      assert.equal(vm.run().output, '');
    } finally { watch.stop(); }
  });

  test(`Stopwatch lifecycle ${engine}: completed Main still permits stopped and ordinary framework Object.ToString`, () => {
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => { throw new Error('These overrides do not sample a clock'); }});
    const {platform, vm} = watch, handles = [];
    try {
      const values = [[watch.reference, '00:00:00']];
      for (const [owner, text] of [['System.Text.StringBuilder', 'builder'], ['System.Uri', 'https://example.com/path?q=1']]) {
        const reference = constructor(platform, owner, text);
        handles.push(platform.heap.createHandle(reference));
        values.push([reference, text]);
      }
      completeMain(vm);
      for (const [reference, expected] of values) virtualText(platform, reference, expected);
      assert.equal(platform.hostOperations.closed, false);
      assert.equal(platform.heap.pins.length, 0);
      assert.equal(vm.state, 'terminated');
    } finally {
      for (const handle of handles) platform.heap.releaseHandle(handle);
      watch.stop();
    }
  });

  test(`Stopwatch lifecycle ${engine}: a clock callback can explicitly stop a VM whose Main already completed`, () => {
    for (const operation of ['Stop', 'get_Elapsed', 'Object.ToString']) {
      for (const exit of ['return', 'throw']) stopAfterCompletion(engine, operation, exit);
    }
  });

  test(`Stopwatch lifecycle ${engine}: restoring live execution after an explicit stop permits pure BCL continuation`, () => {
    let now = 1000n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const {vm, call, platform} = watch;
    try {
      call('Start');
      const saved = vm.snapshot();
      vm.stop();
      assert.equal(platform.hostOperations.closed, true);
      assert.equal(vm.state, 'terminated');
      vm.restore(saved);
      assert.equal(vm.state, engine === 'source' ? 'paused' : 'ready');
      assert.equal(platform.hostOperations.closed, true, 'Restore does not reopen external host operations');
      now += 1_500_000_000n;
      assert.equal(call('get_ElapsedMilliseconds'), 1500n);
      virtualText(platform, watch.reference, '00:00:01.5000000');
      call('Stop');
      assert.equal(call('get_ElapsedTicks'), 1_500_000_000n);
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), false);
      assert.equal(platform.stopwatchClockState.previous, now);
      assert.equal(platform.hostOperations.closed, true);
      assert.equal(platform.heap.pins.length, 0);
    } finally { watch.stop(); }
  });
}
