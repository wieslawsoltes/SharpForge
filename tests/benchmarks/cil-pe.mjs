import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { MetadataBuilder, Writer } from '@sharpforge/cil';
const { readPE, writePE } = await import(process.argv[2] ?? '@sharpforge/cil');

const metadata = new MetadataBuilder('Bench').finish();
const section = new Writer().zero(65536).bytes(metadata).finish();
const bytes = writePE(section, 65536, metadata.length, 0);
function measure(action, count = 30) {
  const times = [], allocations = [];
  for (let index = 0; index < count; index++) {
    global.gc?.();
    const heap = process.memoryUsage().heapUsed;
    const started = performance.now();
    action();
    times.push(performance.now() - started);
    allocations.push(Math.max(0, process.memoryUsage().heapUsed - heap));
  }
  const coldMs = times[0];
  times.sort((left, right) => left - right);
  allocations.sort((left, right) => left - right);
  return { coldMs, medianMs: times[Math.floor(count / 2)], p95Ms: times[Math.floor(count * 0.95)],
    p99Ms: times[count - 1], medianHeapDeltaBytes: allocations[Math.floor(count / 2)] };
}
console.log(JSON.stringify({ node: process.version, os: platform(), architecture: arch(), cpu: cpus()[0].model,
  bytes: bytes.length, write: measure(() => writePE(section, 65536, metadata.length, 0)),
  read: measure(() => readPE(bytes)), allocationMethod: 'heapUsed delta with explicit GC before each operation' }, null, 2));
