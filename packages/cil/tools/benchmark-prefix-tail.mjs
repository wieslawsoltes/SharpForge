import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { CilWriter, validateTailPrefixes } from '../src/index.js';

const cases = [];
for (const count of [1000, 5000]) {
  const writer = new CilWriter();
  for (let index = 0; index < count; index++) writer.group('call', 0x06000001, [{ name: 'tail.' }]).op('ret');
  const code = writer.finish();
  for (let warmup = 0; warmup < 3; warmup++) validateTailPrefixes(code);
  const samples = [];
  for (let sample = 0; sample < 9; sample++) {
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    const groups = validateTailPrefixes(code);
    samples.push({ milliseconds: performance.now() - start, heapDelta: process.memoryUsage().heapUsed - before });
    if (groups.length !== count * 2) throw Error('Unexpected group count');
  }
  const times = samples.map(value => value.milliseconds).sort((left, right) => left - right);
  cases.push({ calls: count, codeBytes: code.length, medianMs: times[4], p95Ms: times[8], samples });
}
console.log(JSON.stringify({ revision: process.env.SF_BENCH_REVISION ?? null, node: process.version,
  cpu: cpus()[0].model, platform: process.platform, arch: process.arch, cases }, null, 2));
