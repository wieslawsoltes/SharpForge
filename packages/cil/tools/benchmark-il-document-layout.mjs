import { writeFileSync } from 'node:fs';
import { assembleILDocument, formatILDocument } from '../src/index.js';
import { managedFixture } from '../../../tests/managed-fixtures.js';

const [label, mode, output] = process.argv.slice(2);
const results = [];
for (const count of [1000, 5000]) {
  const bytes = managedFixture({ methods: [{ name: 'Main', result: 'int', body: writer => writer.zero(count).op('ldc.i4', 42).op('ret') }] });
  let document = formatILDocument(bytes);
  if (mode === 'strings') {
    let index = 0;
    document = document.replace(/(IL_[\da-f]+): nop/g, (_, label) => {
      const value = index++;
      return `${label}: ldstr \"new string ${value}\"\n  IL_${(0xf0000 + value).toString(16)}: pop`;
    });
  }
  const samples = [];
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const memory = process.memoryUsage(), started = performance.now();
    const result = assembleILDocument(document, { relaxBranches: mode === 'layout' });
    const elapsed = performance.now() - started, after = process.memoryUsage();
    if (sample > 1) samples.push({ ms: elapsed, heapDelta: after.heapUsed - memory.heapUsed, resultBytes: result.bytes.length });
  }
  const sorted = key => samples.map(sample => sample[key]).sort((left, right) => left - right);
  results.push({ count, documentCharacters: document.length, medianMs: sorted('ms')[3], p95Ms: sorted('ms')[6],
    medianHeapDelta: sorted('heapDelta')[3], samples });
}
const report = { label, mode, node: process.version, platform: process.platform, architecture: process.arch, results };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(results));
