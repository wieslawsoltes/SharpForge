import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { MetadataBuilder, fieldSignature } from '@sharpforge/cil';

const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.floor(values.length * fraction)];
const measure = (operation, iterations) => {
  const samples = [];
  for (let sample = 0; sample < 31; sample++) {
    const start = performance.now();
    for (let iteration = 0; iteration < iterations; iteration++) operation();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  return { medianUs: percentile(samples, .5), p95Us: percentile(samples, .95), p99Us: percentile(samples, .99) };
};
const construct = () => new MetadataBuilder('Benchmark');
for (let index = 0; index < 1000; index++) construct();
const construction = measure(construct, 1000);
let typedRows = null;
const probe = construct();
if (probe.definitions.constantValue) {
  const signature = fieldSignature('int');
  typedRows = measure(() => {
    const builder = construct();
    for (let index = 0; index < 1000; index++) {
      const Parent = builder.definitions.field({ Flags: 0x56, Name: `F${index}`, Signature: signature });
      builder.definitions.constantValue({ Parent, Type: 'int', Value: index });
    }
  }, 1);
}
console.log(JSON.stringify({ revision: process.argv[2] ?? 'working-tree', node: process.version,
  cpu: os.cpus()[0].model, platform: process.platform, arch: process.arch, samples: 31,
  note: 'Shared host; sequential local validation. Typed-row cost includes 1000 Field rows and one builder; allocations unmeasured.',
  construction, typedRows }, null, 2));
