import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

// Copy this same runner into the Ordinal baseline and run both revisions serially.
const iterations = Number(process.argv[2] ?? 20);
assert(Number.isInteger(iterations) && iterations >= 20 && iterations <= 50, 'Iterations must be within 20..50');
// Digit keys keep this compiler control independent of the default collation profile.
const source = `using System;using System.Collections.Generic;using System.Text;
  class Program {
    static void Main() {
      var values = new List<string>(new string[] {"3", "1", "2"});
      values.Sort();
      var builder = new StringBuilder();
      for (int i = 0; i < values.Count; i++) builder.Append(values[i]);
      object same = builder;
      Console.WriteLine(builder.ToString());
      Console.WriteLine(Object.ReferenceEquals(builder, same));
      Console.WriteLine(StringComparer.Ordinal.Compare("a", "A") > 0);
    }
  }`;
const expected = '123\nTrue\nTrue\n';

function sample() {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let result;
  const started = performance.now();
  for (let index = 0; index < iterations; index++) result = compileToIL(source, {pipeline: 'bound'});
  const elapsedMs = performance.now() - started;
  const heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  // Runtime construction and semantic-output checks do not contribute to compilation timings.
  for (const vm of [new VirtualMachine(result.image), new CilVirtualMachine(result.assembly)]) {
    try {
      const actual = vm.run();
      assert.equal(actual.state, 'terminated', actual.fault?.stack);
      assert.equal(actual.output, expected);
    } finally { vm.stop(); }
  }
  return {elapsedMs, perCompilationMs: elapsedMs / iterations, heapUsedDeltaBytes};
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[2], p95: sorted[4]};
}

sample();
const samples = Array.from({length: 5}, sample);
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  iterations, warmupCount: 1, sampleCount: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Repeated bound compileToIL on existing supported framework/object-reference source',
  notes: 'Identical source on baseline/candidate. Host heap deltas may include GC; they are not allocation counts. Execution checks excluded.',
  elapsedMs: summarize(samples.map(row => row.elapsedMs)),
  perCompilationMs: summarize(samples.map(row => row.perCompilationMs)),
  heapUsedDeltaBytes: summarize(samples.map(row => row.heapUsedDeltaBytes)),
  samples
}, null, 2));
