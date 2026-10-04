import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { verifyCilMethodTypes } from '../src/index.js';
import { objectCase, prepareObject } from '../../../tests/helpers/object-verifier.js';

const output = process.argv[2];
if (!output) throw new Error('Pass a result JSON path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = readFileSync(new URL('../../../tests/fixtures/a03-type-categories/native.json', import.meta.url));
const repeated = { name: 'RepeatedConstructor', body(writer, input) {
  for (let index = 0; index < 128; index++) writer.op('newobj', input.constructors.Owner).op('pop');
  writer.op('ret');
} };
const fixtures = ['NewClass', 'NewArguments', 'BoxValue', 'HarmlessAnnotation', 'UnboxFieldRead'].map(objectCase);
fixtures.push(repeated);
const results = {};
for (const fixture of fixtures) {
  const { input, inspector, options } = prepareObject(fixture);
  const samples = [];
  const heapDeltas = [];
  for (let sample = 0; sample < 12; sample++) {
    const heapBefore = process.memoryUsage().heapUsed;
    const start = performance.now();
    for (let iteration = 0; iteration < 1000; iteration++) {
      const report = verifyCilMethodTypes(inspector, input.method, options);
      if (report.status !== 'verified') throw new Error(JSON.stringify({ name: fixture.name, report }));
    }
    samples.push(performance.now() - start);
    heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
  }
  const sorted = samples.slice(3).toSorted((left, right) => left - right);
  results[fixture.name] = { iterations: 1000, fixtureSHA256: hash(input.bytes), samples, heapDeltas,
    medianMs: sorted[4], p95Ms: sorted[8] };
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  purpose: 'Added object capability costs; no comparison against baseline unknown results',
  warmupSamples: 3, coreCaptureSHA256: hash(capture), results }, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, value]) =>
  [name, { medianMs: value.medianMs, p95Ms: value.p95Ms }]))));
