import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { arrayContext } from '../../../tests/clr-types-array-fixtures.js';

function summary(name, samples) {
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99] };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const types = arrayContext().types;
  const element = types.intrinsic('System.Int32');
  const start = performance.now();
  types.szArray(element);
  cold.push((performance.now() - start) * 1000);
}
const types = arrayContext().types;
const element = types.intrinsic('System.Int32');
const canonical = types.szArray(element);
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (types.szArray(element) !== canonical) throw new Error('Noncanonical array');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold vector descriptors with pre-registered BCL', cold), summary('warm vector lookup', warm)] }, null, 2));
