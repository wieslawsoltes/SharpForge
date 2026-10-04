import { writeFileSync } from 'node:fs';
import { AssemblyInspector, createMetadataVerificationContext as create } from '../src/index.js';
import { nestedFixture } from '../../../tests/fixtures/a03-nested-access/input.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an explicit JSON output path');
const input = nestedFixture();
const context = create(new AssemblyInspector(input.bytes));
const type = name => context.resolveType(input.types[name]).value;
const outer = type('Outer'), other = type('Other'), hidden = type('PublicInPrivate');
const sibling = type('Sibling'), family = type('Visibility4'), derived = type('NestedDerived');
let sink;
const results = [];
for (const [name, operation] of [
  ['top-level-type', () => { sink = context.isTypeAccessible(outer, other); }],
  ['private-container-denied', () => { sink = context.isTypeAccessible(hidden, other); }],
  ['enclosing-private-type', () => { sink = context.isTypeAccessible(hidden, sibling); }],
  ['enclosing-family-type', () => { sink = context.isTypeAccessible(family, derived); }],
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
