import test from 'node:test';
import assert from 'node:assert/strict';
import {stopwatchPlatform, stopwatchContract} from './fixtures/stopwatch.js';

const maximum = 9_223_372_036_854_775_807n;
const fault = (code, name = 'InvalidOperationException') => error => error.name === name && error.message.startsWith(code + ':');

for (const engine of ['source', 'cil']) {
  test(`Stopwatch ${engine}: malformed, failed and decreasing clock reads preserve all managed state`, () => {
    let value = 1000n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
      if (value instanceof Error) throw value;
      return value;
    }});
    const {call, platform, reference} = watch;
    try {
      call('Start');
      const data = [...platform.record(reference).data];
      const allocations = platform.heap.stats.allocations;
      for (const invalid of [-1n, maximum + 1n, 0, NaN, Infinity, -Infinity, '1000', null, {}, undefined]) {
        value = invalid;
        assert.throws(() => call('Stop'), fault('BCLSW0004'));
        assert.throws(() => call('Restart'), fault('BCLSW0004'));
        assert.deepEqual(platform.record(reference).data, data);
      }
      value = new Error('Host failed');
      assert.throws(() => call('get_ElapsedTicks'), fault('BCLSW0003'));
      value = 999n;
      assert.throws(() => call('Stop'), fault('BCLSW0005'));
      assert.deepEqual(platform.record(reference).data, data);
      assert.equal(platform.heap.stats.allocations, allocations);
      value = 1100n; call('Stop');
      assert.equal(call('get_ElapsedTicks'), 100n);
      assert.equal(platform.heap.pins.length, 0);
    } finally { watch.stop(); }
  });

  test(`Stopwatch ${engine}: exact endpoint ticks and explicit option/async/reentrant clock diagnostics`, () => {
    for (const value of [0n, maximum]) {
      const watch = stopwatchPlatform(engine, {stopwatchClock: () => value});
      try { assert.equal(watch.staticCall('GetTimestamp'), value); } finally { watch.stop(); }
    }
    for (const stopwatchClock of [null, 0, 'clock', {}]) {
      const watch = stopwatchPlatform(engine, {stopwatchClock});
      try {
        assert.equal(watch.call('get_ElapsedTicks'), 0n);
        assert.throws(() => watch.call('Start'), fault('BCLSW0001', 'ArgumentException'));
      } finally { watch.stop(); }
    }
    const asynchronous = stopwatchPlatform(engine, {stopwatchClock: async () => 0n});
    try { assert.throws(() => asynchronous.staticCall('GetTimestamp'), fault('BCLSW0004')); } finally { asynchronous.stop(); }
    const recursive = stopwatchPlatform(engine, {stopwatchClock: () => recursive.staticCall('GetTimestamp')});
    try {
      assert.throws(() => recursive.staticCall('GetTimestamp'), fault('BCLSW0006'));
      assert.equal(recursive.platform.heap.pins.length, 0);
    } finally { recursive.stop(); }
  });

  test(`Stopwatch ${engine}: swallowed recursive reads and same-watch resets retain the sticky diagnostic and captured state`, () => {
    for (const operation of ['Start', 'Stop', 'Restart', 'get_Elapsed', 'ToString', 'GetTimestamp']) {
      let now = 1000n, reenter = false, nested;
      const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
        if (reenter) {
          try {
            if (operation === 'GetTimestamp') watch.staticCall('GetTimestamp');
            else watch.platform.invoke(stopwatchContract('Reset'), [{...watch.reference}]);
          } catch (error) { nested = error; }
        }
        return now;
      }});
      try {
        watch.call('Start'); now = 1100n; watch.call('Stop');
        if (operation !== 'Start') watch.call('Start');
        const data = [...watch.platform.record(watch.reference).data];
        const allocations = watch.platform.heap.stats.allocations, writes = watch.vm.writeRevision;
        now = 1200n; reenter = true;
        const invoke = () => operation === 'GetTimestamp' ? watch.staticCall(operation) : watch.call(operation);
        assert.throws(invoke, fault('BCLSW0006'), operation);
        assert(nested && fault('BCLSW0006')(nested), operation);
        assert.deepEqual(watch.platform.record(watch.reference).data, data, operation);
        assert.equal(watch.platform.heap.stats.allocations, allocations, operation);
        assert.equal(watch.vm.writeRevision, writes, operation);
        assert.equal(watch.platform.stopwatchClockState.previous, 1100n, operation);
        assert.equal(watch.platform.stopwatchClockState.reading, false);
        assert.equal(watch.platform.stopwatchClockState.reference, null);
        assert.equal(watch.platform.heap.pins.length, 0);
        reenter = false;
        watch.call('Reset');
        assert.equal(watch.call('get_ElapsedTicks'), 0n);
        assert.equal(watch.staticCall('GetTimestamp'), 1200n);
      } finally { watch.stop(); }
    }
  });

  test(`Stopwatch ${engine}: a clock callback may reset a different watch without sampling another clock`, () => {
    let now = 1000n, reads = 0, other = null, resetOther = false;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
      reads++;
      if (resetOther) watch.platform.invoke(stopwatchContract('Reset'), [other]);
      return now;
    }});
    const {platform, call, staticCall} = watch;
    other = staticCall('.ctor');
    const handle = platform.heap.createHandle(other);
    try {
      platform.invoke(stopwatchContract('Start'), [other]); now = 1100n;
      platform.invoke(stopwatchContract('Stop'), [other]);
      assert.equal(platform.invoke(stopwatchContract('get_ElapsedTicks'), [other]), 100n);
      const before = reads;
      resetOther = true; now = 1200n; call('Start');
      assert.equal(reads, before + 1);
      assert.equal(Boolean(platform.native(call('get_IsRunning'))), true);
      assert.deepEqual(platform.record(other).data, ['$elapsed', 0n, '$started', 0n, '$running', false]);
      assert.equal(platform.stopwatchClockState.previous, 1200n);
      assert.equal(platform.heap.pins.length, 0);
    } finally { platform.heap.releaseHandle(handle); watch.stop(); }
  });

  test(`Stopwatch ${engine}: invalid receivers and Int64 arguments fail before clock reads or managed allocation`, () => {
    let reads = 0;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => { reads++; return 0n; }});
    const {platform, staticCall} = watch;
    const allocations = platform.heap.stats.allocations;
    try {
      for (const name of ['Start', 'Stop', 'Reset', 'Restart', 'get_Elapsed', 'get_ElapsedTicks', 'ToString']) {
        assert.throws(() => platform.invoke(stopwatchContract(name), [null]), {name: 'NullReferenceException'});
      }
      for (const value of [0, 1.5, NaN, Infinity, maximum + 1n, -maximum - 2n, '0', null]) {
        assert.throws(() => staticCall('GetElapsedTime', ['long'], [value]), {name: 'ArgumentOutOfRangeException'});
        assert.throws(() => staticCall('GetElapsedTime', ['long', 'long'], [0n, value]), {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(reads, 0);
      assert.equal(platform.heap.stats.allocations, allocations);
      const other = platform.make('System.Text.StringBuilder');
      assert.throws(() => platform.invoke(stopwatchContract('Start'), [other]), {name: 'InvalidCastException'});
    } finally { watch.stop(); }
  });

  test(`Stopwatch ${engine}: managed allocation failures retain elapsed state and release temporary roots`, () => {
    let now = 0n;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => now});
    const {platform, call, staticCall} = watch;
    const budget = platform.heap.maxBytes;
    try {
      call('Start'); now = 1_500_000_000n; call('Stop');
      platform.heap.maxBytes = 1;
      for (const invoke of [() => staticCall('.ctor'), () => staticCall('StartNew'), () => call('get_Elapsed'), () => call('ToString')]) {
        assert.throws(invoke, {name: 'OutOfMemoryException'});
        assert.equal(call('get_ElapsedTicks'), 1_500_000_000n);
        assert.equal(platform.heap.pins.length, 0);
      }
      assert.equal(staticCall('GetTimestamp'), now);
      call('Reset');
      assert.equal(call('get_ElapsedMilliseconds'), 0n);
    } finally { platform.heap.maxBytes = budget; watch.stop(); }
  });

  test(`Stopwatch ${engine}: default performance source yields monotonic nanoseconds and rejects nonfinite readings`, context => {
    const real = stopwatchPlatform(engine);
    try {
      const first = real.staticCall('GetTimestamp');
      assert.equal(typeof first, 'bigint');
      assert(first >= 0n && first <= maximum);
      assert(real.staticCall('GetTimestamp') >= first);
    } finally { real.stop(); }
    for (const value of [NaN, Infinity, -Infinity, -1, 10_000_000_000_000]) {
      const invalid = stopwatchPlatform(engine);
      context.mock.method(globalThis.performance, 'now', () => value);
      try { assert.throws(() => invalid.staticCall('GetTimestamp'), fault('BCLSW0004')); }
      finally { context.mock.restoreAll(); invalid.stop(); }
    }
  });
}
