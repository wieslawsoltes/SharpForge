import { writeFileSync } from 'node:fs';
import { AssemblyInspector, createMetadataVerificationContext as create } from '../src/index.js';
import { nestedFixture } from '../../../tests/fixtures/a03-nested-access/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit JSON output path');
const input = nestedFixture();
const context = create(new AssemblyInspector(input.bytes));
const member = name => context.resolveMember(input.members[name]).value;
const type = name => context.resolveType(input.types[name]).value;
const outer = member('Outer.Static1field'), inner = type('Deep');
const hidden = member('PublicInPrivate.Static6method'), other = type('Other');
const family = member('Outer.Instance4method'), derived = type('NestedDerived');
const options = { receiverType: type('Derived') };
let sink;
const results = [];
for (const [name, operation] of [
  ['enclosing-private', () => { sink = context.isMemberAccessible(outer, inner); }],
  ['private-container-denied', () => { sink = context.isMemberAccessible(hidden, other); }],
  ['enclosing-family-receiver', () => { sink = context.isMemberAccessible(family, derived, options); }],
]) {
  const samples = [], iterations = 1024;
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed, start = performance.now();
    for (let index = 0; index < iterations; index++) operation();
    const microseconds = (performance.now() - start) * 1000 / iterations;
    if (sample > 1) samples.push({ microseconds, heapDeltaPerCall: (process.memoryUsage().heapUsed - heap) / iterations });
  }
  const sorted = samples.map(value => value.microseconds).sort((a, b) => a - b);
  results.push({ name, iterations, samples, medianUs: sorted[3], p95Us: sorted[6] });
}
if (!sink) throw new Error('No queries executed');
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform, architecture: process.arch,
  results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ samples, ...summary }) => summary)));
