import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { ManagedResourceReader } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-resources/native-resources.json', import.meta.url)));
const bytes = Buffer.from(fixture.files[0].image, 'base64');
const reader = new ManagedResourceReader(bytes);
let checksum = 0;

function measure(name, operation, iterations) {
  for (let index = 0; index < 20; index++) checksum += operation();
  const samples = [];
  for (let sample = 0; sample < 100; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) checksum += operation();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99] };
}

const results = [
  measure('cold index including owned input copy', () => {
    const local = new ManagedResourceReader(bytes);
    const count = local.count;
    local.dispose();
    return count;
  }, 100),
  measure('cold index and complete value enumeration', () => {
    const local = new ManagedResourceReader(bytes);
    const count = [...local.entries()].length;
    local.dispose();
    return count;
  }, 100),
  measure('warm scalar lookup', () => reader.get('int').value, 10000),
  measure('owned byte-array lookup', () => reader.get('bytes').value.length, 10000),
];
reader.dispose();
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, imageBytes: bytes.length, entries: fixture.files[0].entries.length,
  allocationCount: 'not measured', previousEquivalentImplementation: false, checksum, results }, null, 2));
