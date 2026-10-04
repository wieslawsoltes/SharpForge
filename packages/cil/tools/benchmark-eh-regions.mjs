import { buildExceptionRegionTree, validateExceptionInstructionPlacement } from '@sharpforge/cil';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';

const operation = process.argv[2] ?? 'tree';
if (operation !== 'tree' && operation !== 'placement') throw Error('Expected tree or placement');
const validate = operation === 'tree' ? buildExceptionRegionTree : validateExceptionInstructionPlacement;
const cases = [];
for (const count of [1000, 10000]) {
  const bytes = new Uint8Array(count + 2);
  const clauses = Array.from({ length: count }, (_, index) => ({
    start: 0, end: 1, target: index + 1, handlerEnd: index + 2, catchType: 0x01000001,
  }));
  for (let warmup = 0; warmup < 10; warmup++) validate(bytes, clauses);
  const samples = [];
  for (let sample = 0; sample < 15; sample++) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const tree = validate(bytes, clauses);
    samples.push({ milliseconds: performance.now() - start, heapDelta: process.memoryUsage().heapUsed - before });
    if (tree.regions.length !== count + 1) throw Error('Unexpected region count');
  }
  const sorted = samples.map(sample => sample.milliseconds).sort((left, right) => left - right);
  cases.push({ clauses: count, medianMs: sorted[7], p95Ms: sorted[14], samples });
}
console.log(JSON.stringify({ operation, node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0].model, cases }, null, 2));
