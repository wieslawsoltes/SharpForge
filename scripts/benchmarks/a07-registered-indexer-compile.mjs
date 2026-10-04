// Copy this identical runner to parent 938d86fe; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';

const iterations = Number(process.argv[2] ?? 5);
assert(Number.isInteger(iterations) && iterations >= 1 && iterations <= 20, 'Iterations must be within 1..20');
const sources = {
  item: `using System; using System.Collections.Generic;
    class Program { static void Main() {
      var items = new List<int>(); items.Add(3); items.Add(7);
      var values = new Dictionary<string, int>(); values["x"] = 4;
      for (int index = 0; index < 2; index++) { items[index] += values["x"]; values["x"] = items[index]; }
      Console.WriteLine(items[0]); Console.WriteLine(values["x"]);
    } }`,
  string: `using System; class Program { static void Main() {
    string value = "abc"; char first = value[0]; char last = value[value.Length - 1];
    Console.WriteLine(first); Console.WriteLine(last);
  } }`
};

function sample(source, pipeline) {
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  let result;
  for (let index = 0; index < iterations; index++) result = compileToIL(source, {pipeline});
  const elapsedMs = performance.now() - started;
  const heapUsedDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert(result.image && result.assembly);
  return {elapsedMs, perCompilationMs: elapsedMs / iterations, heapUsedDeltaBytes};
}

function summary(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[2], p95: sorted[4]};
}

const workloads = {};
for (const pipeline of ['bound', 'legacy']) {
  workloads[pipeline] = {};
  for (const [name, source] of Object.entries(sources)) {
    sample(source, pipeline);
    const samples = Array.from({length: 5}, () => sample(source, pipeline));
    workloads[pipeline][name] = {
      elapsedMs: summary(samples.map(row => row.elapsedMs)),
      perCompilationMs: summary(samples.map(row => row.perCompilationMs)),
      heapUsedDeltaBytes: summary(samples.map(row => row.heapUsedDeltaBytes)), samples
    };
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  iterations, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Compile-only bound/legacy compileToIL of unchanged Item and string indexers',
  notes: 'No VM execution. Optional host GC and assertions excluded; heap deltas are not allocation counts.', workloads
}, null, 2));
