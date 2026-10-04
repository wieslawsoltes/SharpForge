import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import * as cil from '../src/index.js';

const operation = process.argv[2] ?? 'validateExceptionControlFlow';
if (!['validateExceptionBranches', 'validateExceptionControlFlow'].includes(operation)) {
  throw Error('Expected an exception-control-flow validation operation');
}
const validate = cil[operation];
if (typeof validate !== 'function') throw Error('Expected a validation function export');

function fixture(count) {
  // Shared try has two instructions; each catch leaves to its associated try's second instruction.
  const code = new Uint8Array(2 + count * 6 + 1);
  const view = new DataView(code.buffer);
  code[0] = 0x00;
  code[1] = 0x7a;
  code[code.length - 1] = 0x2a;
  const handlers = [];
  for (let index = 0; index < count; index++) {
    const target = 2 + index * 6;
    code[target] = 0x26;
    code[target + 1] = 0xdd;
    view.setInt32(target + 2, 1 - (target + 6), true);
    handlers.push({ start: 0, end: 2, target, handlerEnd: target + 6, catchType: 0x01000001 });
  }
  return { code, handlers };
}

const cases = [];
for (const count of [1000, 10000]) {
  const { code, handlers } = fixture(count);
  for (let warmup = 0; warmup < 10; warmup++) validate(code, handlers);
  const samples = [];
  for (let sample = 0; sample < 15; sample++) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const tree = validate(code, handlers);
    samples.push({ milliseconds: performance.now() - start, heapDelta: process.memoryUsage().heapUsed - before });
    if (tree.regions.length !== count + 1) throw Error('Unexpected region count');
  }
  const sorted = samples.map(sample => sample.milliseconds).sort((left, right) => left - right);
  cases.push({ clauses: count, leaves: count, codeBytes: code.length, medianMs: sorted[7], p95Ms: sorted[14], samples });
}
console.log(JSON.stringify({ source: process.env.SF_BENCH_REVISION ?? null, operation,
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0].model, cases }, null, 2));
