import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AssemblyInspector, verifyCilAssembly } from '../src/index.js';
import { entryFixture } from '../../../tests/fixtures/a03-handler-entry/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const results = {};
for (const [name, options] of Object.entries({ noHandlers: { noHandlers: true }, catch: {}, finally: { flags: 2 } })) {
  const { bytes } = entryFixture(options);
  const inspector = new AssemblyInspector(bytes);
  const samples = [];
  for (let sample = 0; sample < 12; sample++) {
    const start = performance.now();
    for (let index = 0; index < 1000; index++) {
      if (!verifyCilAssembly(inspector).success) throw new Error(`Control ${name} must remain accepted`);
    }
    samples.push(performance.now() - start);
  }
  const sorted = samples.slice(3).toSorted((left, right) => left - right);
  results[name] = { iterations: 1000, medianMs: sorted[4], p95Ms: sorted[8], samples,
    fixtureSHA256: createHash('sha256').update(bytes).digest('hex') };
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  warmupSamples: 3, results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) =>
  [name, { medianMs: value.medianMs, p95Ms: value.p95Ms }]))));
