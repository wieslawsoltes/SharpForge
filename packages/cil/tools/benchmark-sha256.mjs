import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { sha256 } from '../src/binary/hash.js';

if (!globalThis.gc) throw new Error('Run with --expose-gc for memory samples');
const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.floor(values.length * fraction)];
const results = [];
for (const [bytes, iterations] of [[0, 4096], [64, 4096], [65536, 32], [1048576, 2]]) {
  const input = Uint8Array.from({ length: bytes }, (_, index) => index * 73 & 255);
  const expected = createHash('sha256').update(input).digest('hex');
  assert.equal(Buffer.from(sha256(input)).toString('hex'), expected);
  for (let iteration = 0; iteration < 8; iteration++) sha256(input);
  const times = [];
  const heap = [];
  const buffers = [];
  for (let sample = 0; sample < 31; sample++) {
    globalThis.gc();
    const before = process.memoryUsage();
    const digest = sha256(input);
    const after = process.memoryUsage();
    heap.push(after.heapUsed - before.heapUsed);
    buffers.push(after.arrayBuffers - before.arrayBuffers);
    assert.equal(Buffer.from(digest).toString('hex'), expected);
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) sha256(input);
    times.push((performance.now() - start) * 1000 / iterations);
  }
  results.push({ bytes, iterations, medianUs: percentile(times, .5), p95Us: percentile(times, .95),
    p99Us: percentile(times, .99), medianHeapDeltaBytes: percentile(heap, .5),
    medianArrayBufferDeltaBytes: percentile(buffers, .5) });
}
console.log(JSON.stringify({ revision: process.argv[2] ?? 'working-tree', node: process.version,
  platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, samples: 31,
  note: 'Shared host; one local validation job. Memory is sampled delta for one call, not a peak-allocation profiler.', results }, null, 2));
