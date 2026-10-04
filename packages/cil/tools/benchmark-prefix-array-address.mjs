import { writeFileSync } from 'node:fs';
import { CilWriter, readPE, validateTypePrefixes } from '../src/index.js';
import { prefixTypeFixture } from '../../../tests/fixtures/a03-prefix-array-address/input.js';

const [output, mode = 'address'] = process.argv.slice(2);
if (!output || !['address', 'control'].includes(mode)) throw new Error('Pass an output path and address/control mode');
const pe = readPE(prefixTypeFixture(), { inspection: true });
const rows = pe.metadata.rows[10];
const member = 0x0a000001 + rows.findIndex(row => pe.metadata.string(row[1]) === 'Address');
const results = [];
for (const count of [1000, 5000]) {
  const writer = new CilWriter();
  for (let index = 0; index < count; index++) {
    const prefix = mode === 'control' ? { name: 'constrained.', operand: 0x02000002 } : { name: 'readonly.' };
    writer.group('callvirt', member, [prefix]);
  }
  const bytes = writer.finish();
  const samples = [];
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    const groups = validateTypePrefixes(bytes, pe.metadata);
    const ms = performance.now() - started;
    const heapDelta = process.memoryUsage().heapUsed - heap;
    if (sample > 1) samples.push({ ms, heapDelta, groups: groups.length });
  }
  const sorted = samples.map(value => value.ms).sort((left, right) => left - right);
  results.push({ count, bytes: bytes.length, medianMs: sorted[3], p95Ms: sorted[6], samples });
}
writeFileSync(output, JSON.stringify({ mode, node: process.version, platform: process.platform,
  architecture: process.arch, results }, null, 2) + '\n');
console.log(JSON.stringify(results.map(({ samples, ...summary }) => summary)));
