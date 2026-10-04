import { writeFileSync } from 'node:fs';
import { CilWriter, decodeInstructions } from '../src/index.js';

const [label, mode, output] = process.argv.slice(2);
function measure(count) {
  const writer = new CilWriter();
  for (let index = 0; index < count; index++) writer.op('br', 'end');
  writer.mark('end').op('ret');
  const bytes = writer.finish(), samples = [];
  let resultBytes = bytes.length;
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const before = process.memoryUsage(), started = performance.now();
    const result = mode === 'layout' ? writer.finishWithLayout() : decodeInstructions(bytes);
    const elapsed = performance.now() - started, after = process.memoryUsage();
    resultBytes = mode === 'layout' ? result.code.length : bytes.length;
    if (sample > 1) samples.push({ ms: elapsed, heapDelta: after.heapUsed - before.heapUsed });
  }
  const sorted = key => samples.map(sample => sample[key]).sort((left, right) => left - right);
  return { count, inputBytes: bytes.length, resultBytes, medianMs: sorted('ms')[3], p95Ms: sorted('ms')[6],
    medianHeapDelta: sorted('heapDelta')[3], samples };
}
const report = { label, mode, node: process.version, platform: process.platform, architecture: process.arch,
  results: [measure(1000), measure(10000)] };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.results));
