import { writeFileSync } from 'node:fs';
import { AssemblyInspector, createMetadataVerificationContext as create } from '../src/index.js';
import { accessFixture } from '../../../tests/fixtures/a03-member-access/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit benchmark JSON output path');
const input = accessFixture();
const inspector = new AssemblyInspector(input.bytes);
const context = create(inspector);
const token = input.members.Instance6method;
const member = context.resolveMember(token).value;
const family = context.resolveMember(input.members.Instance4field).value;
const derived = context.resolveType(input.types.Derived).value;
let sink;
const cases = [
  ['construct-context', 64, () => { sink = create(inspector); }],
  ['cached-member', 16384, () => { sink = context.resolveMember(token); }],
];
if (context.isMemberAccessible) cases.push(
  ['public-access', 16384, () => { sink = context.isMemberAccessible(member, derived); }],
  ['family-access', 1024, () => { sink = context.isMemberAccessible(family, derived, { receiverType: derived }); }],
);
const results = [];
for (const [name, iterations, operation] of cases) {
  const samples = [];
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed, started = performance.now();
    for (let index = 0; index < iterations; index++) operation();
    const microseconds = (performance.now() - started) * 1000 / iterations;
    if (sample > 1) samples.push({ microseconds, heapDeltaPerCall: (process.memoryUsage().heapUsed - heap) / iterations });
  }
  const sorted = samples.map(value => value.microseconds).sort((left, right) => left - right);
  results.push({ name, iterations, samples, medianUs: sorted[3], p95Us: sorted[6] });
}
if (!sink) throw new Error('Benchmark did not execute');
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ samples, ...summary }) => summary)));
