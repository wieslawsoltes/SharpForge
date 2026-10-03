import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-contexts/native-contexts.json', import.meta.url)));
const bytes = Buffer.from(fixture.images[0], 'base64');
const session = new AssemblyLoadSession();
const assembly = await session.defaultContext.loadFromStream(bytes);

async function measure(name, operation, iterations) {
  for (let warmup = 0; warmup < 20; warmup++) await operation();
  const samples = [];
  await new Promise(resolve => setImmediate(resolve));
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  for (let sample = 0; sample < 100; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) await operation();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  // WeakRef keeps newly observed targets alive until the next job, even after explicit GC.
  await new Promise(resolve => setImmediate(resolve));
  globalThis.gc?.();
  const retainedHeapBytes = process.memoryUsage().heapUsed - before;
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99],
    retainedHeapBytes, exactAllocationCount: 'not measured' };
}

const results = [
  await measure('cold context and stream metadata load', async () => {
    const local = new AssemblyLoadSession();
    await local.defaultContext.loadFromStream(bytes);
  }, 10),
  await measure('warm assembly identity binding', () => session.defaultContext.loadFromAssemblyName(assembly.identity), 100),
  await measure('cached method body defensive copy', () => assembly.manifestModule.methodBody(0x06000001), 100),
];
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, imageBytes: bytes.length, gcAvailable: typeof globalThis.gc === 'function', results }, null, 2));
