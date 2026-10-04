import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { compileToAssembly } from '@sharpforge/compiler';

const source = `using System.Threading.Tasks; using System.Collections.Generic;
class P {
  static int Sum(int count) { int sum = 0; for (int index = 0; index < count; index++) { int value = index + 1; sum += value; } return sum; }
  static async Task<int> Later(Task<int> task) { int value = 10; await task; return value + Sum(10); }
  static IEnumerable<int> Items() { for (int index = 0; index < 4; index++) yield return index; }
  static void Main() { System.Console.WriteLine(Sum(10)); }
}`;

const rounds = 40;
const samples = 7;
const warmups = 150;
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
const options = [false, true].map(portablePdb => ({ name: 'DebugBench', portablePdb }));
const results = options.map(option => ({ portablePdb: option.portablePdb, assemblyBytes: 0, pdbBytes: 0, samplesMs: [] }));
// Warm both paths before measurement; even an implementation that ignores the option must compare equally.
for (let warmup = 0; warmup < warmups; warmup++) for (const option of options) compileToAssembly(source, option);
for (let sample = 0; sample < samples; sample++) {
  for (const index of sample % 2 ? [1, 0] : [0, 1]) {
    const record = results[index];
    const start = performance.now();
    for (let round = 0; round < rounds; round++) {
      const result = compileToAssembly(source, options[index]);
      if (!result.success) throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
      record.assemblyBytes = result.assembly.length;
      record.pdbBytes = result.pdb?.length ?? 0;
    }
    record.samplesMs.push((performance.now() - start) / rounds);
  }
}
for (const result of results) {
  const sorted = [...result.samplesMs].sort((left, right) => left - right);
  result.medianMs = percentile(sorted, 0.5);
  result.p95Ms = percentile(sorted, 0.95);
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, warmups, rounds, samples, results }, null, 2));
