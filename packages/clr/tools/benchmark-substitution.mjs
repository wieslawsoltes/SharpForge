import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { decodeSignature } from '@sharpforge/cil';
import { substituteSignature } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-substitution/native-signatures.json', import.meta.url)));
const primitive = name => ({ kind: 'primitive', name });
const inputs = native.cases.map(item => ({ signature: decodeSignature(Buffer.from(item.signature, 'base64')), options: {
  typeArguments: item.typeArguments.map(primitive), methodArguments: item.methodArguments?.map(primitive),
} }));
const samples = [];
let result;
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 100; iteration++) {
    for (const input of inputs) result = substituteSignature(input.signature, input.options);
  }
  if (sample >= 10) samples.push((performance.now() - start) * 1000 / (inputs.length * 100));
}
if (!Object.isFrozen(result)) throw new Error('Expected immutable signature');
samples.sort((left, right) => left - right);
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  cases: inputs.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [{ name: 'bounded member signature substitution', unit: 'microseconds/operation',
    median: samples[50], p95: samples[95], p99: samples[99] }] }, null, 2));
