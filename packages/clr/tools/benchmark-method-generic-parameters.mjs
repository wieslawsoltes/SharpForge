import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-generic-parameters/native-parameters.json', import.meta.url)));
const image = Buffer.from(native.image, 'base64');
const load = async () => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
function summary(name, samples) {
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99] };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const module = await load();
  const start = performance.now();
  for (const method of native.methods) module.methodGenericParameters(method.token);
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const methods = native.methods.map(item => module.methodDefinition(item.token));
const canonical = methods.map(method => method.genericParameters);
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    const index = iteration % methods.length;
    if (methods[index].genericParameters !== canonical[index]) throw new Error('Noncanonical method parameter array');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  methods: native.methods.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold all fixture method generic parameters', cold), summary('cached method parameter array', warm)] }, null, 2));
