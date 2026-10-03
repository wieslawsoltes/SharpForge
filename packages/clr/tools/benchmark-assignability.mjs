import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { assignabilityFixture } from '../../../tests/clr-types-assignability-fixtures.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-assignability/native-assignability.json', import.meta.url)));
const image = Buffer.from(native.image, 'base64');
function summarize(name, samples) {
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99] };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const { types, entries } = await assignabilityFixture(image);
  const pairs = native.pairs.map(pair => [entries.get(pair.target), entries.get(pair.source), pair.result]);
  const start = performance.now();
  for (const [target, source, expected] of pairs) {
    if (types.isAssignableFrom(target, source) !== expected) throw new Error('Unexpected assignability');
  }
  cold.push((performance.now() - start) * 1000 / pairs.length);
}
const { types, entries } = await assignabilityFixture(image);
const target = entries.get('root');
const source = entries.get('child');
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (!types.isAssignableFrom(target, source)) throw new Error('Unexpected assignability');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  pairs: native.pairs.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summarize('cold pair decisions with loaded descriptors', cold), summarize('cached inherited interface decision', warm)] }, null, 2));
