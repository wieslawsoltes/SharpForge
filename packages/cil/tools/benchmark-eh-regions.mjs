import { buildExceptionRegionTree, validateExceptionInstructionPlacement, validateExceptionBranches } from '@sharpforge/cil';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';

const operation = process.argv[2] ?? 'tree';
const operations = { tree: buildExceptionRegionTree, placement: validateExceptionInstructionPlacement, branches: validateExceptionBranches };
if (!Object.hasOwn(operations, operation)) throw Error('Expected tree, placement or branches');
const validate = operations[operation];
const cases = [];
for (const count of [1000, 10000]) {
  const start = operation === 'branches' ? 5 + count * 4 : 0;
  const bytes = new Uint8Array(start + count + 2);
  if (operation === 'branches') {
    // N switch targets enter the shared try; throw terminates every EH region without fall-through.
    bytes[0] = 0x45;
    new DataView(bytes.buffer).setUint32(1, count, true);
    bytes.fill(0x7a, start);
    bytes[bytes.length - 1] = 0x2a;
  }
  const clauses = Array.from({ length: count }, (_, index) => ({
    start, end: start + 1, target: start + index + 1, handlerEnd: start + index + 2, catchType: 0x01000001,
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
