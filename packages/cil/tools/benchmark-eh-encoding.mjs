import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { writeMethodBody } from '@sharpforge/cil';

const clause = { flags: 0, start: 0, end: 8, target: 8, handlerEnd: 16, catchType: 0x01000001 };
const definitions = [
  { name: 'small-no-eh', bytes: 64, handlers: [], iterations: 1000 },
  { name: 'small-catch', bytes: 64, handlers: [clause], iterations: 1000 },
  { name: 'large-no-eh', bytes: 65536, handlers: [], iterations: 100 },
];
const results = [];
let checksum = 0;
for (const definition of definitions) {
  const code = new Uint8Array(definition.bytes);
  for (let warmup = 0; warmup < 500; warmup++) checksum ^= writeMethodBody(code, 0, 1, definition.handlers).length;
  const samples = [];
  for (let sample = 0; sample < 21; sample++) {
    global.gc?.();
    const before = process.memoryUsage();
    const start = performance.now();
    for (let index = 0; index < definition.iterations; index++) checksum ^= writeMethodBody(code, 0, 1, definition.handlers).length;
    const microseconds = (performance.now() - start) * 1000 / definition.iterations;
    const after = process.memoryUsage();
    samples.push({ microseconds, heapDelta: after.heapUsed - before.heapUsed, arrayBufferDelta: after.arrayBuffers - before.arrayBuffers });
  }
  const ordered = samples.map(sample => sample.microseconds).sort((left, right) => left - right);
  results.push({ ...definition, handlers: definition.handlers.length, median: ordered[10], p95: ordered[19], samples });
}
console.log(JSON.stringify({ node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model,
  revision: process.env.SF_EH_REVISION ?? null, checksum, results }, null, 2));
