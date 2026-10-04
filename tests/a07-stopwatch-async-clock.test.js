import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {stopwatchPlatform} from './fixtures/stopwatch.js';

const invalidClock = error => error.name === 'InvalidOperationException' && error.message.startsWith('BCLSW0004:');

function assertReleased(watch, previous = null) {
  assert.equal(watch.platform.stopwatchClockState.previous, previous);
  assert.equal(watch.platform.stopwatchClockState.reading, false);
  assert.equal(watch.platform.stopwatchClockState.reference, null);
  assert.equal(watch.platform.synchronousHostCallbackDepth, 0);
  assert.equal(watch.platform.heap.pins.length, 0);
  assert.doesNotThrow(() => watch.vm.snapshot());
}

for (const engine of ['source', 'cil']) {
  test(`Stopwatch async clock ${engine}: rejected Promise remains a managed diagnostic without an orphan host rejection`, async () => {
    const failure = new Error('Rejected asynchronous Stopwatch clock');
    const unhandled = [];
    const observe = reason => unhandled.push(reason);
    const watch = stopwatchPlatform(engine, {stopwatchClock: async () => { throw failure; }});
    process.on('unhandledRejection', observe);
    try {
      const data = [...watch.platform.record(watch.reference).data];
      assert.throws(() => watch.staticCall('GetTimestamp'), invalidClock);
      await nextTurn();
      assert.deepEqual(unhandled, [], 'Rejecting an unsupported asynchronous clock must consume its orphan rejection');
      assert.deepEqual(watch.platform.record(watch.reference).data, data);
      assertReleased(watch);
    } finally {
      process.off('unhandledRejection', observe);
      watch.stop();
    }
  });

  test(`Stopwatch async clock ${engine}: an invalid foreign thenable never invokes its accessors or continuation`, async () => {
    let reads = 0, calls = 0, escapedSnapshot;
    const thenable = Object.create(null);
    Object.defineProperty(thenable, 'then', {get() {
      reads++;
      return resolve => {
        calls++;
        escapedSnapshot = watch.vm.snapshot();
        resolve(0n);
      };
    }});
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => thenable});
    try {
      const data = [...watch.platform.record(watch.reference).data];
      assert.throws(() => watch.call('Start'), invalidClock);
      await nextTurn();
      assert.equal(reads, 0, 'Unsupported values must not trigger foreign thenable accessors');
      assert.equal(calls, 0, 'Unsupported values must not schedule a continuation outside the owned callback boundary');
      assert.equal(escapedSnapshot, undefined);
      assert.deepEqual(watch.platform.record(watch.reference).data, data);
      assertReleased(watch);
    } finally { watch.stop(); }
  });

  test(`Stopwatch async clock ${engine}: native Promise constructor and species hooks stay inside the boundary`, async () => {
    const attempts = [];
    let saved;
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
      const rejected = Promise.reject(new Error('Invalid async clock result'));
      const constructor = {};
      function inspect(hook) {
        for (const action of ['snapshot', 'restore']) {
          const attempt = {hook, action, reading: watch.platform.stopwatchClockState.reading,
            depth: watch.platform.synchronousHostCallbackDepth};
          try {
            attempt.result = action === 'snapshot' ? watch.vm.snapshot() : watch.vm.restore(saved);
          } catch (error) { attempt.error = error; }
          attempts.push(attempt);
        }
      }
      Object.defineProperty(rejected, 'constructor', {get() {
        inspect('constructor');
        return constructor;
      }});
      Object.defineProperty(constructor, Symbol.species, {get() {
        inspect('species');
        return Promise;
      }});
      return rejected;
    }});
    try {
      saved = watch.vm.snapshot();
      const data = [...watch.platform.record(watch.reference).data];
      assert.throws(() => watch.call('Start'), invalidClock);
      await nextTurn();
      assert.deepEqual(attempts.map(({hook, action}) => [hook, action]),
        [['constructor', 'snapshot'], ['constructor', 'restore'], ['species', 'snapshot'], ['species', 'restore']]);
      for (const attempt of attempts) {
        assert.equal(attempt.reading, true);
        assert.equal(attempt.depth, 1);
        assert.equal(attempt.error?.name, 'TypeError');
        assert.match(attempt.error.message, /synchronous host callbacks/);
        assert.equal(attempt.result, undefined);
      }
      assert.deepEqual(watch.platform.record(watch.reference).data, data);
      assertReleased(watch);
    } finally { watch.stop(); }
  });

  test(`Stopwatch async clock ${engine}: discarding a fulfilled Promise never forwards its payload to a new Promise`, async () => {
    let reads = 0, calls = 0, escapedSnapshot;
    const payload = Object.create(null);
    const fulfilled = Promise.resolve(payload);
    Object.defineProperty(payload, 'then', {get() {
      reads++;
      return resolve => {
        calls++;
        escapedSnapshot = watch.vm.snapshot();
        resolve(0n);
      };
    }});
    const watch = stopwatchPlatform(engine, {stopwatchClock: () => fulfilled});
    try {
      const data = [...watch.platform.record(watch.reference).data];
      assert.throws(() => watch.staticCall('GetTimestamp'), invalidClock);
      await nextTurn();
      assert.equal(reads, 0, 'The ignored derived Promise must receive undefined, not the clock payload');
      assert.equal(calls, 0);
      assert.equal(escapedSnapshot, undefined);
      assert.deepEqual(watch.platform.record(watch.reference).data, data);
      assertReleased(watch);
    } finally { watch.stop(); }
  });

  test(`Stopwatch async clock ${engine}: rejection observation precedes explicit stop and sticky reentry exits`, async () => {
    for (const action of ['stop', 'reentry']) {
      let invalid = false;
      const watch = stopwatchPlatform(engine, {stopwatchClock: () => {
        if (!invalid) return 1000n;
        if (action === 'stop') watch.vm.stop();
        else {
          try { watch.staticCall('GetTimestamp'); } catch {}
        }
        return Promise.reject(new Error('Canceled or reentered asynchronous clock'));
      }});
      try {
        watch.call('Start');
        const saved = watch.vm.snapshot();
        const data = [...watch.platform.record(watch.reference).data];
        invalid = true;
        if (action === 'stop') assert.equal(watch.call('Stop'), null);
        else assert.throws(() => watch.call('Stop'), error => error.name === 'InvalidOperationException' && /BCLSW0006/.test(error.message));
        await nextTurn();
        assert.deepEqual(watch.platform.record(watch.reference).data, data);
        assertReleased(watch, 1000n);
        assert.equal(watch.platform.bclHost.isExecutionStopped(watch.platform), action === 'stop');
        assert.equal(watch.vm.fault, null);
        assert.equal(watch.vm.pendingFault, null);
        watch.vm.restore(saved);
        invalid = false;
        watch.call('Stop');
        assert.equal(watch.call('get_ElapsedTicks'), 0n);
        assertReleased(watch, 1000n);
      } finally { watch.stop(); }
    }
  });
}
