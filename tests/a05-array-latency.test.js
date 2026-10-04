import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileFixture} from '../bench/vm/operations.js';
import {microbenchmarks, startupApps} from '../bench/vm/fixtures.js';
import {arrayLatencyFixtures} from '../bench/vm/array-latency-fixtures.js';
import {measureArrayLatency, parseArrayLatencyOptions, runArrayLatency} from '../bench/vm/array-latency.js';

const options = {samples: 2, warmup: 1, nativeBits: 64, timeoutSeconds: 60};

test('array proof reuses the exact canonical grid and vector fixtures without altering the T12 catalog', () => {
  assert.equal(arrayLatencyFixtures[0].fixture, startupApps.find(fixture => fixture.id === 'grid'));
  assert.equal(arrayLatencyFixtures[1].fixture, microbenchmarks.find(fixture => fixture.id === 'arrays'));
  assert.equal(startupApps.length, 3);
  assert.equal(microbenchmarks.length, 8);
});

for (const definition of arrayLatencyFixtures) for (const engine of ['source', 'reloaded', 'cil']) {
  test(`${definition.kind}/${engine}: complete cold/warm array work retains exact result and scoped counters`, async () => {
    const artifact = compileFixture(definition.fixture);
    const row = await measureArrayLatency(definition, engine, artifact, options);
    assert.equal(row.status, 'measured');
    assert.equal(row.fixture, definition.fixture.id);
    assert.equal(row.engine, engine);
    assert.equal(row.backend, engine === 'cil' ? 'CilVirtualMachine' : 'VirtualMachine');
    assert.equal(row.input, engine === 'source' ? 'compiler-source-image' :
      engine === 'reloaded' ? 'reloaded-compiler-assembly' : 'compiler-CIL');
    assert.equal(row.cold.length, 2);
    assert.deepEqual(row.warm.map(sample => sample.phase), ['first', 'warmup', 'measured', 'measured']);
    assert.equal(row.vmOptions.wasmTiering, false);
    const instructions = row.cold[0].instructions;
    for (const sample of [...row.cold, ...row.warm]) {
      assert.equal(sample.outputVerified, true);
      assert.equal(sample.output, definition.fixture.expected);
      assert.equal(sample.instructions, instructions);
      assert(sample.instructions > 0);
      assert(sample.managedAllocations > 0, 'Actual array/output allocations remain within complete-execution counters');
      assert(sample.managedAllocatedBytes > 0);
      assert(sample.executionMs > 0);
      assert(Number.isSafeInteger(sample.collections) && sample.collections >= 0);
    }
    for (const sample of row.cold) {
      assert.equal(sample.preparation.status, 'prepared');
      assert.equal(sample.backend, row.backend);
      const phases = sample.constructionMs + sample.preparationMs + sample.executionMs;
      assert(Math.abs(sample.totalMs - phases) <= Number.EPSILON * 8 * sample.totalMs);
      assert(sample.framesAllocated > 0);
      assert(sample.frameArraysAllocated > 0);
    }
    assert.equal(row.summary.cold.totalMs.count, 2);
    assert.equal(row.summary.warm.executionMs.count, 2);
    assert.equal(row.summary.warm.executionMs.p50, row.summary.warm.executionMs.median);
    assert(row.summary.warm.executionMs.p99 >= row.summary.warm.executionMs.p95);
  });
}

test('incorrect complete array result fails before any cold or warm sample is accepted', async () => {
  const definition = arrayLatencyFixtures[0];
  const artifact = compileFixture({...definition.fixture,
    source: definition.fixture.source.replace('r*8+c', 'r*8+c+1')});
  await assert.rejects(measureArrayLatency(definition, 'cil', artifact, options), error => {
    assert.match(error.message, /incorrect result/);
    assert.equal(error.evidence.status, 'failed');
    assert.equal(error.evidence.cold.length, 0);
    assert.equal(error.evidence.warm.length, 0);
    return true;
  });
});

test('array proof rejects unmeasured engines, invalid bounds and cancellation before guest construction', async () => {
  const definition = arrayLatencyFixtures[0], controller = new AbortController();
  controller.abort(new Error('cancel array measurement'));
  await assert.rejects(measureArrayLatency(definition, 'source', null, options, {signal: controller.signal}), /cancel array measurement/);
  await assert.rejects(measureArrayLatency(definition, 'browser', null, options), /Unknown workload latency engine/);
  await assert.rejects(measureArrayLatency(definition, 'source', null, {...options, samples: 0}), RangeError);
  await assert.rejects(measureArrayLatency(definition, 'source', {assembly: new Uint8Array()}, options, {deadline: 0}),
    /explicit time limit/);
  const args = ['--runner', 'array-proof', '--out', 'artifacts/array-latency.json'];
  assert.throws(() => parseArrayLatencyOptions([...args, '--samples', '2']), RangeError);
  assert.throws(() => parseArrayLatencyOptions([...args, '--warmup', '1', '--warmup', '2']), TypeError);
});

test('array proof refuses to overwrite retained evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-array-latency-'));
  const out = join(directory, 'existing.json');
  try {
    const original = '{"status":"retained"}\n';
    writeFileSync(out, original);
    await assert.rejects(runArrayLatency({out}), /Refusing to overwrite/);
    assert.equal(readFileSync(out, 'utf8'), original);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
