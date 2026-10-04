import test from 'node:test';
import assert from 'node:assert/strict';
import {wasmLatencyFixtures} from '../bench/vm/wasm-latency-fixtures.js';
import {measureWasmLatency} from '../bench/vm/wasm-latency-measure.js';
import {parseWasmLatencyOptions} from '../bench/vm/wasm-latency.js';

const options = parseWasmLatencyOptions(['--runner', 'wasm-latency-test', '--samples', '20', '--warmup', '1',
  '--native-bits', '64', '--timeout-seconds', '60']);

for (const fixture of wasmLatencyFixtures(32)) {
  test(`${fixture.id}: repeated cold preparation and warm calls execute real Wasm with exact scoped counters`, async () => {
    const row = await measureWasmLatency(fixture, options);
    assert.equal(row.status, 'measured');
    assert.equal(row.outputVerified, true);
    assert.equal(row.target, undefined, 'A measurement criterion does not create a performance threshold');
    assert.equal(row.reference.tierAfter, null);
    assert.equal(row.backendProof.outputVerified, true);
    assert.equal(row.backendProof.selectedInstructions, fixture.expectedInstructions);
    for (const cold of row.samples.cold) {
      assert.equal(cold.instructions, 0, 'Cold preparation must include no hidden guest execution');
      assert(cold.coldReadyMs >= cold.constructionMs);
      assert(cold.preparationMs > 0);
      assert(cold.compiledBytes > 0);
      assert.equal(cold.tier.compilationAttempts, 1);
      assert.equal(cold.tier.methods[0].status, 'ready');
    }
    assert(row.samples.interpretedPriming.every(sample => sample.selectedInstructions === 0));
    for (const phase of ['firstCompiled', 'warmCompiled']) {
      assert.equal(row.samples[phase].length, 22);
      for (const sample of row.samples[phase]) {
        assert.equal(sample.selectedInstructions, fixture.expectedInstructions);
        assert.equal(sample.selectedCalls, 1);
        assert.equal(sample.managedAllocations, fixture.expectedManagedAllocations);
        assert.equal(sample.managedAllocatedBytes, row.reference.managedAllocatedBytes);
        assert.equal(sample.outputVerified, true);
      }
      assert.equal(row.summary[phase].executionMs.count, 20);
      assert.equal(row.summary[phase].executionMs.p50, row.summary[phase].executionMs.median);
      assert(row.summary[phase].executionMs.p99 >= row.summary[phase].executionMs.p95);
    }
    assert.equal(row.summary.cold.coldReadyMs.count, 20);
    assert.equal(row.disposals.length, 22);
    assert(row.disposals.every(item => item.state === 'terminated' && item.frames === 0 && item.tier.enabled === false));
  });
}

test('a declined Wasm backend cannot become a successful interpreter timing row', async t => {
  t.mock.method(WebAssembly, 'instantiate', async () => { throw new Error('declined native backend'); });
  await assert.rejects(measureWasmLatency(wasmLatencyFixtures(32)[0], options), error => {
    assert.match(error.message, /Actual Wasm compilation required.*declined native backend/);
    assert.equal(error.evidence.status, 'failed');
    assert.equal(error.evidence.samples.warmCompiled.length, 0);
    assert.equal(error.evidence.samples.cold[0].disposal.frames, 0);
    assert.equal(error.evidence.samples.cold[0].disposal.tier.enabled, false);
    return true;
  });
});

test('incorrect output fails before cold or warm Wasm observations can be accepted', async () => {
  const fixture = {...wasmLatencyFixtures(32)[0], expectedReturn: 33};
  await assert.rejects(measureWasmLatency(fixture, options), error => {
    assert.match(error.message, /output, instruction or managed-allocation mismatch/);
    assert.equal(error.evidence.status, 'failed');
    assert.equal(error.evidence.samples.cold.length, 0);
    assert.equal(error.evidence.samples.warmCompiled.length, 0);
    return true;
  });
});

test('cancellation and bounded options reject before compiling or executing a guest', async t => {
  t.mock.method(WebAssembly, 'instantiate', () => assert.fail('Canceled measurement must not compile'));
  const controller = new AbortController();
  controller.abort(new Error('cancel Wasm latency'));
  await assert.rejects(measureWasmLatency(wasmLatencyFixtures(32)[0], options, controller.signal), /cancel Wasm latency/);
  assert.throws(() => parseWasmLatencyOptions(['--runner', 'bounded', '--samples', '19']), RangeError);
  assert.throws(() => parseWasmLatencyOptions(['--runner', 'bounded', '--target', 'virtual-cache']), /Unknown Wasm latency option/);
  assert.throws(() => wasmLatencyFixtures(31), RangeError);
});
