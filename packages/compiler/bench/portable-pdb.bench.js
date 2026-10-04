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

const rounds = 20;
const samples = 7;
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
const results = [];
for (const portablePdb of [false, true]) {
  const options = { name: 'DebugBench', portablePdb };
  for (let warmup = 0; warmup < 10; warmup++) compileToAssembly(source, options);
  const elapsed = [];
  let assemblyBytes = 0;
  let pdbBytes = 0;
  for (let sample = 0; sample < samples; sample++) {
    const start = performance.now();
    for (let round = 0; round < rounds; round++) {
      const result = compileToAssembly(source, options);
      if (!result.success) throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
      assemblyBytes = result.assembly.length;
      pdbBytes = result.pdb?.length ?? 0;
    }
    elapsed.push((performance.now() - start) / rounds);
  }
  const sorted = [...elapsed].sort((left, right) => left - right);
  results.push({ portablePdb, medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), assemblyBytes, pdbBytes, samplesMs: elapsed });
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, rounds, samples, results }, null, 2));
