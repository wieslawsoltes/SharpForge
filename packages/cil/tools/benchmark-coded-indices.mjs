import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { decodeCoded } from '../src/index.js';

const output = process.argv[2];
if (!output) throw new Error('Pass an output JSON path');
const values = new Uint32Array(256);
for (let index = 0; index < values.length; index++) values[index] = (index + 1) * 4 + index % 3;
const samples = [];
let checksum = 0;
for (let sample = 0; sample < 12; sample++) {
  const started = performance.now();
  for (let index = 0; index < 1000000; index++) checksum ^= decodeCoded('TypeDefOrRef', values[index & 255]);
  samples.push(performance.now() - started);
}
const sorted = samples.slice(3).toSorted((left, right) => left - right);
const result = { node: process.version, platform: process.platform, arch: process.arch, iterations: 1000000,
  warmupSamples: 3, medianMs: sorted[4], p95Ms: sorted[8], checksum, samples };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ medianMs: result.medianMs, p95Ms: result.p95Ms, checksum }));
