import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createMetadataVerificationTypeSystem } from '../src/index.js';
import { typeSystemFixture } from '../../../tests/fixtures/a03-verifier-types/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const fixture = typeSystemFixture();
const inspector = fixture.inspect();
const adapter = createMetadataVerificationTypeSystem(inspector);
const source = adapter.resolveType(fixture.tokens.Left).value;
const target = adapter.resolveType(fixture.tokens.IContract).value;
const modes = {
  construction: () => createMetadataVerificationTypeSystem(inspector),
  inheritedInterface: () => adapter.isAssignable(source, target),
};
const results = {};
for (const [name, operation] of Object.entries(modes)) {
  const samples = [];
  for (let sample = 0; sample < 12; sample++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let index = 0; index < 1000; index++) operation();
    samples.push({ ms: performance.now() - start, heapDelta: process.memoryUsage().heapUsed - heap });
  }
  const sorted = samples.slice(3).map(sample => sample.ms).sort((a, b) => a - b);
  results[name] = { iterations: 1000, medianMs: sorted[4], p95Ms: sorted[8], samples };
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  warmupSamples: 3, host: 'shared; no before/after or speedup claim', results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, { samples, ...summary }]) => [name, summary]))));
