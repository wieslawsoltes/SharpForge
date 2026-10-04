import test from 'node:test';
import assert from 'node:assert/strict';
import {stopwatchPlatform, stopwatchContract} from './fixtures/stopwatch.js';

for (const engine of ['source', 'cil']) {
  test(`Stopwatch ${engine}: repeated transitions, resume and restart preserve exact counters and 1500 ms`, () => {
    let now = 9_007_199_254_740_993n;
    let reads = 0;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => { reads++; return now; }});
    const {call, platform, span} = watch;
    try {
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), false);
      assert.equal(call('get_ElapsedTicks'), 0n);
      assert.equal(platform.native(call('ToString')), '00:00:00');
      call('Stop'); call('Reset');
      assert.equal(reads, 0);
      call('Start'); call('Start');
      assert.equal(reads, 1);
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), true);
      now += 1_500_000_000n;
      assert.equal(call('get_ElapsedMilliseconds'), 1500n);
      assert.equal(call('get_ElapsedTicks'), 1_500_000_000n);
      const elapsed = call('get_Elapsed');
      assert.equal(platform.get(elapsed, '$ticks'), 15_000_000n);
      assert.equal(span(elapsed), 1500);
      assert.equal(span(elapsed, 'TotalSeconds'), 1.5);
      call('Stop');
      const stoppedReads = reads;
      now += 2_000_000_000n;
      call('Stop');
      assert.equal(call('get_ElapsedTicks'), 1_500_000_000n);
      assert.equal(platform.native(call('ToString')), '00:00:01.5000000');
      assert.equal(reads, stoppedReads);
      call('Start'); now += 500_000_000n; call('Stop');
      assert.equal(call('get_ElapsedMilliseconds'), 2000n);
      call('Restart');
      assert.equal(call('get_ElapsedTicks'), 0n);
      now += 100n;
      assert.equal(platform.native(call('ToString')), '00:00:00.0000001');
      call('Reset');
      assert.equal(call('get_ElapsedTicks'), 0n);
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), false);
    } finally { watch.stop(); }
  });

  test(`Stopwatch ${engine}: running snapshots retain exact state while the host clock continues`, () => {
    let now = 0n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const {vm, call, platform} = watch;
    try {
      call('Start'); now = 1_500_000_000n;
      const saved = vm.snapshot();
      const before = call('get_ElapsedMilliseconds');
      now += 1_500_000_000n; call('Stop');
      vm.restore(saved);
      assert.equal(call('get_ElapsedMilliseconds'), 3000n);
      assert(call('get_ElapsedMilliseconds') >= before);
      now = 9_007_199_254_740_993n;
      assert.equal(call('get_ElapsedTicks'), now);
      call('Stop');
      const stopped = vm.snapshot();
      call('Reset'); vm.restore(stopped);
      assert.equal(call('get_ElapsedTicks'), 9_007_199_254_740_993n);
      assert.equal(platform.heap.pins.length, 0);
      now = 0n;
      assert.throws(() => call('Start'), error => error.name === 'InvalidOperationException' && /BCLSW0005/.test(error.message));
    } finally { watch.stop(); }
  });

  test(`Stopwatch ${engine}: clocks and objects are independent and StartNew survives clock and write observer collection`, () => {
    let now = 100n;
    const first = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const second = stopwatchPlatform(engine, {stopwatchClock: () => 0n});
    try {
      first.call('Start'); second.call('Start'); now += 100n;
      assert.equal(first.call('get_ElapsedTicks'), 100n);
      assert.equal(second.call('get_ElapsedTicks'), 0n);
      const fresh = stopwatchPlatform(engine, {stopwatchClock: () => { fresh.platform.heap.collect(); return now; }});
      try {
        fresh.vm.onWrite = () => fresh.platform.heap.collect();
        const running = fresh.staticCall('StartNew');
        now += 100n;
        const ticks = fresh.platform.invoke(stopwatchContract('get_ElapsedTicks'), [running]);
        assert.equal(ticks, 100n);
        assert.equal(fresh.platform.heap.pins.length, 0);
      } finally { fresh.vm.onWrite = null; fresh.stop(); }
    } finally { first.stop(); second.stop(); }
  });

  test(`Stopwatch ${engine}: transitions use constant managed storage and throwing observers see complete state`, () => {
    let now = 0n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const {vm, platform, call, reference} = watch;
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const observerFailure = new Error('Stopwatch observer failed');
    try {
      for (let index = 0; index < 100; index++) {
        call('Start'); now += 100n; call('Stop');
      }
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(platform.heap.stats.allocatedBytes, bytes);
      call('Start'); now += 100n;
      vm.onWrite = () => { platform.heap.collect(); throw observerFailure; };
      assert.throws(() => call('Stop'), error => error === observerFailure);
      vm.onWrite = null;
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), false);
      assert.equal(call('get_ElapsedTicks'), 10_100n);
      assert.equal(platform.record(reference).data.length, 6);
      assert.equal(platform.heap.pins.length, 0);
    } finally { vm.onWrite = null; watch.stop(); }
  });
}
