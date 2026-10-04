import assert from 'node:assert/strict';
import {cpus, platform, arch, totalmem} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {ExecutionOccupancy} from '../../apps/studio/workers/execution-occupancy.js';

const iterations = 10_000, repetitions = 9, warmups = 3;
const compiled = compileToIL(`using System;
class Program {
  static void Main() {
    int total = 0;
    for (int i = 0; i < ${iterations}; i++) total += i;
    Console.WriteLine(total);
  }
}`, {includeDebug: false, portablePdb: false});
assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));

function run(engine, measured) {
  const output = [];
  const options = {onOutput: value => output.push(value), recordHistory: false};
  const session = engine === 'source' ? new DebugSession(compiled.image, options) : new CilDebugSession(compiled.assembly, options);
  session.start(false);
  const profile = new ExecutionOccupancy();
  profile.reset(1);
  const pump = () => session.pump({instructionBudget: 15_000, timeBudgetMs: 6});
  let slices = 0;
  const started = performance.now();
  while (session.vm.state === 'running' || session.vm.state === 'ready') {
    if (measured) profile.measure('managed', pump);
    else pump();
    slices++;
    if (slices > 10_000) throw new Error('Benchmark exceeded its bounded pump count');
  }
  const elapsedMs = performance.now() - started;
  profile.close();
  assert.equal(session.vm.state, 'terminated');
  assert.equal(output.join(''), (iterations * (iterations - 1) / 2) + '\n');
  session.stop();
  return {elapsedMs, slices, measuredBusyMs: measured ? profile.read().totalBusyMs : null};
}

function summarize(samples) {
  const values = samples.map(sample => sample.elapsedMs).sort((left, right) => left - right);
  return {medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * 0.95) - 1], samples};
}

const results = [];
for (const engine of ['source', 'direct-cil']) {
  for (let index = 0; index < warmups; index++) { run(engine, false); run(engine, true); }
  const baseline = [], instrumented = [];
  for (let index = 0; index < repetitions; index++) {
    // Alternate order to expose order/JIT noise; compilation and session construction are outside each sample.
    if (index % 2) {
      instrumented.push(run(engine, true));
      baseline.push(run(engine, false));
    } else {
      baseline.push(run(engine, false));
      instrumented.push(run(engine, true));
    }
  }
  const before = summarize(baseline), after = summarize(instrumented);
  results.push({engine, baseline: before, instrumented: after,
    medianChangePercent: (after.medianMs / before.medianMs - 1) * 100,
    p95ChangePercent: (after.p95Ms / before.p95Ms - 1) * 100});
}
console.log(JSON.stringify({schema: 1, benchmark: 'a19-worker-execution-occupancy',
  command: 'node scripts/limited.js node tests/bench/a19-execution-occupancy.mjs',
  environment: {node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
    logicalProcessors: cpus().length, memoryBytes: totalmem(), sharedMachine: true},
  fixture: {iterations, repetitions, warmups, instructionBudget: 15_000, timeBudgetMs: 6},
  methodology: 'Matched synchronous managed pump workload with/without the clock-pair wrapper; actual source and direct JavaScript CIL backends. ' +
    'Shared-machine samples are observations, not a browser latency or native CPU regression verdict. No allocation profiler was run.',
  results}, null, 2));
