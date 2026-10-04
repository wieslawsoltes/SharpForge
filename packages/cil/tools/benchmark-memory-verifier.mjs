import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AssemblyInspector, verifyCilMethodTypes } from '../src/index.js';
import { memoryCases, memoryFixture } from '../../../tests/fixtures/verifier-memory/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass a result JSON path');
const results = {};
for (const name of ['LoadInteger', 'StoreStringInObject', 'LocalAddressRoundtrip', 'LoadWideInteger']) {
  const fixture = memoryCases.find(value => value.name === name);
  const bytes = memoryFixture(fixture);
  const inspector = new AssemblyInspector(bytes);
  const samples = [];
  for (let sample = 0; sample < 12; sample++) {
    const start = performance.now();
    for (let iteration = 0; iteration < 1000; iteration++) {
      if (verifyCilMethodTypes(inspector, 0x06000001).status !== fixture.status) throw new Error(`Unexpected ${name} result`);
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
