import { writeFileSync } from 'node:fs';
import { CilWriter, decodeInstructionGroups, validateMemoryPrefixes } from '../src/index.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const results = [];
for (const count of [1000, 5000]) {
  const writer = new CilWriter();
  for (let index = 0; index < count; index++) writer.op('volatile.').op('unaligned.', 1).op('ldind.i4');
  const bytes = writer.finish();
  for (const [mode, operation] of [['grouping', decodeInstructionGroups], ['validation', validateMemoryPrefixes]]) {
    const samples = [];
    for (let sample = 0; sample < 9; sample++) {
      globalThis.gc?.();
      const memory = process.memoryUsage().heapUsed;
      const started = performance.now();
      const groups = operation(bytes);
      const elapsed = performance.now() - started;
      const heapDelta = process.memoryUsage().heapUsed - memory;
      if (sample > 1) samples.push({ ms: elapsed, heapDelta, groups: groups.length });
    }
    const sorted = samples.map(value => value.ms).sort((left, right) => left - right);
    results.push({ count, bytes: bytes.length, mode, medianMs: sorted[3], p95Ms: sorted[6], samples });
  }
}
writeFileSync(output, JSON.stringify({ node: process.version, platform: process.platform,
  architecture: process.arch, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ samples, ...summary }) => summary)));
