import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-method-definitions/native-methods.json', import.meta.url)));
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
  for (const definition of native.definitions) module.methodDefinitions(definition.token);
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const token = native.definitions[0].methods[0].token;
const method = module.methodDefinition(token);
const signature = method.signature;
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (module.methodDefinition(token).signature !== signature) throw new Error('Noncanonical method or signature');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  definitions: native.definitions.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold all fixture method identities', cold), summary('cached method and signature lookup', warm)] }, null, 2));
