import { cpus, platform, arch } from 'node:os';
import { performance } from 'node:perf_hooks';
import { encodeCustomAttribute } from '@sharpforge/cil';

const types = ['bool', 'int', 'long', 'double', 'string', { kind: 'szarray', element: 'byte' }, 'object'];
const values = [true, -1, 9007199254740993n, 1.25, 'attribute', [0, 1, 255], { type: 'string', value: 'boxed' }];
const named = [{ name: 'Enabled', isField: false, type: 'bool', value: true }];
const operation = () => encodeCustomAttribute(types, values, named);
const iterations = 2000;
const samples = [];
for (let index = 0; index < iterations; index++) operation();
for (let sample = 0; sample < 31; sample++) {
  const start = performance.now();
  for (let index = 0; index < iterations; index++) operation();
  samples.push((performance.now() - start) * 1000 / iterations);
}
samples.sort((left, right) => left - right);
console.log(JSON.stringify({ cpu: cpus()[0].model, platform: `${platform()} ${arch()}`, node: process.version,
  operation: 'encode 7 fixed arguments and 1 named property', iterations, samples: samples.length,
  medianMicroseconds: samples[15], p95Microseconds: samples[29], p99Microseconds: samples[30],
  outputBytes: operation().length, baseline: 'First encoder implementation; no existing encoder baseline.' }, null, 2));
