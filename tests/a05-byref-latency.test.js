import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFixture} from '../bench/vm/operations.js';
import {byrefLatencyFixture as fixture} from '../bench/vm/byref-latency-fixture.js';
import {measureByrefLatency} from '../bench/vm/byref-latency-measurement.js';
import {parseByrefLatencyOptions} from '../bench/vm/byref-latency.js';

const options = {samples: 2, warmup: 1, nativeBits: 64, timeoutSeconds: 60};

for (const engine of ['source', 'reloaded', 'cil']) {
  test(`${engine}: byref latency retains complete cold/warm executions and exact result/counter scope`, async () => {
    const artifact = compileFixture(fixture);
    const row = await measureByrefLatency(engine, artifact, options);
    assert.equal(row.status, 'measured');
    assert.equal(row.engine, engine);
    assert.equal(row.backend, engine === 'cil' ? 'CilVirtualMachine' : 'VirtualMachine');
    assert.equal(row.cold.length, 2);
    assert.deepEqual(row.warm.map(sample => sample.phase), ['first', 'warmup', 'measured', 'measured']);
    assert(row.cold.every(sample => sample.backend === row.backend));
    const instructions = row.cold[0].instructions;
    for (const sample of [...row.cold, ...row.warm]) {
      assert.equal(sample.outputVerified, true);
      assert.equal(sample.output, fixture.expected);
      assert.equal(sample.instructions, instructions);
      assert(sample.collections >= 4, 'Guest collection must run while nested references remain live');
      assert(sample.managedAllocations > 0, 'Actual Cell/array/output allocations remain visible');
      assert(sample.managedAllocatedBytes > 0);
      assert(sample.executionMs > 0);
    }
    for (const sample of row.cold) {
      assert.equal(sample.totalMs, sample.constructionMs + sample.preparationMs + sample.executionMs);
      assert(sample.framesAllocated > 0);
      assert(sample.frameArraysAllocated > 0);
    }
    assert.equal(row.summary.cold.totalMs.count, 2);
    assert.equal(row.summary.warm.executionMs.count, 2);
    assert.equal(row.summary.warm.executionMs.p50, row.summary.warm.executionMs.median);
    assert(row.summary.warm.executionMs.p99 >= row.summary.warm.executionMs.p95);
  });
}

test('byref latency rejects wrong guest output instead of publishing a measured row', async () => {
  const artifact = compileFixture({...fixture, source: fixture.source.replace('local += 1;', 'local += 2;')});
  await assert.rejects(measureByrefLatency('cil', artifact, options), error => {
    assert.match(error.message, /incorrect result/);
    assert.equal(error.evidence.status, 'failed');
    assert.equal(error.evidence.cold.length, 0);
    return true;
  });
});

test('byref latency validates bounds and cancellation before constructing a guest', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancel byref measurement'));
  await assert.rejects(measureByrefLatency('source', null, options, controller.signal), /cancel byref measurement/);
  await assert.rejects(measureByrefLatency('wrong', null, options), /Unknown byref latency engine/);
  for (const change of [{samples: 0}, {samples: 1001}, {warmup: 0}, {nativeBits: 16}, {timeoutSeconds: Infinity}]) {
    await assert.rejects(measureByrefLatency('source', null, {...options, ...change}), RangeError);
  }
  const args = ['--runner', 'test-runner', '--out', 'artifacts/byref.json'];
  assert.equal(parseByrefLatencyOptions(args).samples, 100);
  assert.throws(() => parseByrefLatencyOptions([...args, '--samples', '2']), RangeError);
  assert.throws(() => parseByrefLatencyOptions([...args, '--warmup', '1', '--warmup', '2']), TypeError);
});
