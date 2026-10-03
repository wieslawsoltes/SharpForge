import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { AssemblyName, AssemblyProvider, AssemblyResolver } from '../src/index.js';

const entries = Array.from({ length: 10000 }, (_, index) => ({ identity: `Library${index}, Version=1.0.0.0` }));
const provider = new AssemblyProvider('memory', entries);
const requested = AssemblyName.parse('Library5000, Version=1.0.0.0');
const warmResolver = new AssemblyResolver({ providers: [provider] });
warmResolver.resolve(requested);

function measure(name, operation, iterations) {
  const samples = [];
  for (let warmup = 0; warmup < 100; warmup++) operation();
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let sample = 0; sample < 100; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) operation();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  globalThis.gc?.();
  const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99],
    retainedHeapBytes, exactAllocationCount: 'not measured' };
}

const results = [
  measure('parse display name', () => AssemblyName.parse('Library5000, Version=1.0.0.0'), 100),
  measure('cold indexed resolution', () => {
    const resolver = new AssemblyResolver({ providers: [provider] });
    resolver.resolve(requested);
    resolver.dispose();
  }, 100),
  measure('cached indexed resolution', () => warmResolver.resolve(requested), 1000),
];
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, providerEntries: entries.length, gcAvailable: typeof globalThis.gc === 'function', results }, null, 2));
