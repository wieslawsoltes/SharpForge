import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { MetadataBuilder, readMetadata, validateMetadata } from '@sharpforge/cil';
import { metadataFixture } from '../../tests/fixtures/a03-metadata/fixture.js';

function measure(action, iterations = 30) {
  const values = [];
  const allocations = [];
  for (let index = 0; index < iterations; index++) {
    global.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    action();
    values.push(performance.now() - start);
    allocations.push(Math.max(0, process.memoryUsage().heapUsed - heap));
  }
  const cold = values[0];
  values.sort((a, b) => a - b);
  allocations.sort((a, b) => a - b);
  const percentile = n => values[Math.min(values.length - 1, Math.floor(values.length * n))];
  return { coldMs: cold, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    medianHeapDeltaBytes: allocations[Math.floor(allocations.length / 2)] };
}

const bytes = metadataFixture().builder.finish();
const blobs = measure(() => {
  const builder = new MetadataBuilder('Blobs');
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < 100000; index++) { view.setUint32(0, index, true); builder.blob(bytes); }
}, 10);
const read = measure(() => readMetadata(bytes));
const validate = measure(() => validateMetadata(readMetadata(bytes)));
console.log(JSON.stringify({ node: process.version, os: platform(), arch: arch(), cpu: cpus()[0].model,
  measurement: 'heapUsed delta is an allocation proxy; explicit GC before iterations when --expose-gc is passed',
  blobs100k: blobs, read, validate }, null, 2));
