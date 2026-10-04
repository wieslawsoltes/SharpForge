import { writeFileSync } from 'node:fs';
import { CilWriter } from '../src/index.js';

const [label, output] = process.argv.slice(2);
const count = 65536;
function measure(compact) {
  const samples = [];
  let bytes;
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const writer = new CilWriter(count * 9, { compact });
    const before = process.memoryUsage();
    const started = performance.now();
    for (let index = 0; index < count; index++) {
      writer.integer((index & 255) - 128).local('ldloc', index & 511);
    }
    const elapsed = performance.now() - started;
    const after = process.memoryUsage();
    bytes = writer.length;
    if (sample > 1) samples.push({ ms: elapsed, heapDelta: after.heapUsed - before.heapUsed });
  }
  const sorted = key => samples.map(sample => sample[key]).sort((left, right) => left - right);
  return { compact, instructionPairs: count, bytes, medianMs: sorted('ms')[3], p95Ms: sorted('ms')[6],
    medianHeapDelta: sorted('heapDelta')[3], samples };
}
const report = { label, node: process.version, platform: process.platform, architecture: process.arch,
  results: [measure(false), measure(true)] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.results));
