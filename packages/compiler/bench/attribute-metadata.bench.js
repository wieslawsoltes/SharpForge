import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileToAssembly } from '@sharpforge/compiler';

const programs = [
  { name: 'plain', source: 'public class C { public int Value; public int Twice(int value) { return value * 2; } }' },
  { name: 'attributes', source: `using System;
    [AttributeUsage(AttributeTargets.All)] public class MarkAttribute : Attribute { public MarkAttribute(string text) { } }
    [Mark("type")] public class C {
      [Mark("field")] public int Value;
      [Mark("property")] public string Name { get; set; }
      [return: Mark("return")] public int Twice([Mark("parameter")] int value) { return value * 2; }
    }` },
];
const warmups = 120, rounds = 30, samples = 9;
const implementations = [{ name: 'candidate', emit: compileToAssembly }];
if (process.argv[2]) {
  const module = await import(pathToFileURL(resolve(process.argv[2], 'packages/compiler/src/index.js')).href);
  implementations.unshift({ name: 'baseline', emit: module.compileToAssembly });
}
const cases = programs.flatMap(program => implementations.map(implementation => ({ ...program, ...implementation, fixture: program.name })));
const results = cases.map(entry => ({ name: entry.fixture, implementation: entry.name, samplesMs: [], assemblyBytes: 0 }));
const options = { name: 'AttributeBench', outputKind: 'library' };
function compile(entry) {
  const result = entry.emit(entry.source, options);
  if (!result.assembly) throw new Error(result.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
  return result.assembly.length;
}
for (let index = 0; index < warmups; index++) for (const entry of cases) compile(entry);
globalThis.gc?.();
const heapBefore = process.memoryUsage().heapUsed;
for (let sample = 0; sample < samples; sample++) {
  const order = cases.map((_, index) => index);
  for (const index of sample % 2 ? order.reverse() : order) {
    const started = performance.now();
    for (let round = 0; round < rounds; round++) results[index].assemblyBytes = compile(cases[index]);
    results[index].samplesMs.push((performance.now() - started) / rounds);
  }
}
globalThis.gc?.();
const memory = process.memoryUsage();
for (const result of results) {
  const sorted = [...result.samplesMs].sort((left, right) => left - right);
  result.medianMs = sorted[Math.ceil(sorted.length * 0.5) - 1];
  result.p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1];
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
  warmups, rounds, samples, gcExposed: !!globalThis.gc, heapBefore, retainedHeapAfter: memory.heapUsed, rss: memory.rss, results }, null, 2));
