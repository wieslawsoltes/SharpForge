import { writeFileSync } from 'node:fs';
import { CilWriter, readPE, decodeInstructionGroups, validateTypePrefixes } from '../src/index.js';

import { managedFixture } from '../../../tests/managed-fixtures.js';

const metadata = readPE(managedFixture(), { inspection: true }).metadata;
const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const results = [];
for (const count of [1000, 5000]) {
  const writer = new CilWriter();
  for (let index = 0; index < count; index++) writer.op('constrained.', 0x02000002).op('callvirt', 0x0a000001);
  const bytes = writer.finish();
  for (const [mode, operation] of [['grouping', decodeInstructionGroups], ['validation', validateTypePrefixes]]) {
    const samples = [];
    for (let sample = 0; sample < 9; sample++) {
      globalThis.gc?.();
      const memory = process.memoryUsage().heapUsed;
      const started = performance.now();
      const groups = mode === 'validation' ? operation(bytes, metadata) : operation(bytes);
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
