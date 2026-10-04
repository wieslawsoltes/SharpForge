import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AssemblyInspector, verifyCilMethodTypes, createMetadataVerificationTypeSystem } from '../src/index.js';
import { coreAuthority, externalFixture } from '../../../tests/fixtures/a03-type-categories/input.js';
import { nativeCategoryInput } from '../../../tests/fixtures/a03-type-categories/native-input.js';
import { fieldFixture, fieldAuthority } from '../../../tests/fixtures/verifier-fields/input.js';
import { fieldCases } from '../../../tests/fixtures/verifier-fields/cases.js';

const output = process.argv[2];
const mode = process.argv[3];
if (!output || !['baseline', 'candidate'].includes(mode)) throw new Error('Pass output JSON and baseline/candidate mode');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const categoryInput = externalFixture(coreAuthority());
const inspector = categoryInput.inspect();
const nativeCapture = readFileSync(new URL('../../../tests/fixtures/a03-type-categories/native.json', import.meta.url));
const workloads = [{ name: 'existingAuthorityConstruction', expected: 'reference',
  fixtureSHA256: hash(JSON.stringify(categoryInput.builder.rows)), run() {
    const types = createMetadataVerificationTypeSystem(inspector, { coreTypes: categoryInput.coreTypes });
    return types.typeCategory(types.resolveType(categoryInput.tokens.LocalClass).value).value;
  } }];
const core = mode === 'candidate' ? { coreTypes: nativeCategoryInput(JSON.parse(nativeCapture)).coreAuthority } : null;
for (const name of mode === 'candidate' ? ['LoadOwner', 'StoreReferenceDerived'] : []) {
  const input = fieldFixture(fieldCases.find(value => value.name === name));
  const inspector = new AssemblyInspector(input.bytes);
  const options = { coreTypes: fieldAuthority(core, input) };
  workloads.push({ name, fixtureSHA256: hash(input.bytes), expected: 'verified',
    run: () => verifyCilMethodTypes(inspector, input.method, options).status });
}
const results = {};
for (const workload of workloads) {
  const samples = [];
  const heapDeltas = [];
  for (let sample = 0; sample < 12; sample++) {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let iteration = 0; iteration < 1000; iteration++) {
      if (workload.run() !== workload.expected) throw new Error(`Unexpected ${workload.name} result`);
    }
    samples.push(performance.now() - start);
    heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
  }
  const sorted = samples.slice(3).toSorted((left, right) => left - right);
  results[workload.name] = { iterations: 1000, expected: workload.expected, fixtureSHA256: workload.fixtureSHA256,
    medianMs: sorted[4], p95Ms: sorted[8], samples, heapDeltas };
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  mode, warmupSamples: 3, coreCaptureSHA256: hash(nativeCapture), results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) =>
  [name, { medianMs: value.medianMs, p95Ms: value.p95Ms }]))));
