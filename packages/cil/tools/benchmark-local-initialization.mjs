import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AssemblyInspector, verifyCilMethodTypes } from '../src/index.js';
import { initializationFixture, initializationCases } from '../../../tests/fixtures/verifier-initialization/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass a result JSON path');
const results = {};
for (const name of ['StoredLoad', 'DiamondBoth', 'WordBoundaries']) {
  const fixture = initializationCases.find(value => value.name === name);
  const bytes = initializationFixture(fixture);
  const inspector = new AssemblyInspector(bytes);
  const expected = fixture.accepted ? 'verified' : 'rejected';
  for (const mode of ['cold', 'cached']) {
    const iterations = mode === 'cold' ? 100 : 1000;
    const samples = [];
    const heaps = [];
    for (let sample = 0; sample < 12; sample++) {
      const heapBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      for (let iteration = 0; iteration < iterations; iteration++) {
        if (verifyCilMethodTypes(mode === 'cold' ? new AssemblyInspector(bytes) : inspector, 0x06000001,
          { localInitialization: 'definite-assignment' }).status !== expected) throw new Error(`Unexpected ${name} result`);
      }
      samples.push(performance.now() - start);
      heaps.push(process.memoryUsage().heapUsed - heapBefore);
    }
    const sorted = samples.slice(3).toSorted((left, right) => left - right);
    results[name + ':' + mode] = { iterations, medianMs: sorted[4], p95Ms: sorted[8], samples, heapDeltas: heaps,
      fixtureSHA256: createHash('sha256').update(bytes).digest('hex') };
  }
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  warmupSamples: 3, results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) =>
  [name, { medianMs: value.medianMs, p95Ms: value.p95Ms }]))));
