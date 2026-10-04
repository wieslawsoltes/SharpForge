import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { AssemblyInspector, verifyCilMethodTypes } from '../src/index.js';
import { nativeCategoryInput } from '../../../tests/fixtures/a03-type-categories/native-input.js';
import { literalFixture, literalAuthority } from '../../../tests/fixtures/verifier-literals/input.js';
import { literalCases } from '../../../tests/fixtures/verifier-literals/cases.js';

const output = process.argv[2];
if (!output) throw new Error('Pass a result JSON path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeCapture = readFileSync(new URL('../../../tests/fixtures/a03-type-categories/native.json', import.meta.url));
const core = { coreTypes: nativeCategoryInput(JSON.parse(nativeCapture)).coreAuthority };
const repeated = { name: 'RepeatedToken', result: 'void', body(writer, input) {
  for (let index = 0; index < 128; index++) writer.op('ldstr', input.literal('same literal')).op('pop');
  writer.op('ret');
} };
const fixtures = ['StringReturn', 'Length8192', 'StaticStringStore'].map(name => literalCases.find(value => value.name === name));
fixtures.push(repeated);
const results = {};
for (const fixture of fixtures) {
  const input = literalFixture(fixture);
  const inspector = new AssemblyInspector(input.bytes);
  const options = fixture.metadata ? { coreTypes: literalAuthority(core, input) } : {};
  const samples = [];
  const heapDeltas = [];
  for (let sample = 0; sample < 12; sample++) {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let iteration = 0; iteration < 1000; iteration++) {
      const report = verifyCilMethodTypes(inspector, input.method, options);
      if (report.status !== 'verified') throw new Error(JSON.stringify({ fixture: fixture.name, report }));
    }
    samples.push(performance.now() - start);
    heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
  }
  const sorted = samples.slice(3).toSorted((left, right) => left - right);
  results[fixture.name] = { iterations: 1000, fixtureSHA256: hash(input.bytes), samples, heapDeltas,
    medianMs: sorted[4], p95Ms: sorted[8] };
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  purpose: 'Added literal capability costs; no comparison against baseline unknown results',
  warmupSamples: 3, coreCaptureSHA256: hash(nativeCapture), results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) =>
  [name, { medianMs: value.medianMs, p95Ms: value.p95Ms }]))));
