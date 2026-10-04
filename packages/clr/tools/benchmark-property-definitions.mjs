import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-property-definitions/native-properties.json', import.meta.url)));
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
  for (const property of native.properties) {
    const descriptor = module.propertyDefinition(property.token);
    void descriptor.signature;
    void descriptor.getMethod;
    void descriptor.setMethod;
  }
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const property = module.propertyDefinition(native.properties[0].token);
const signature = property.signature;
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (module.propertyDefinition(property.metadataToken).signature !== signature) throw new Error('Noncanonical property signature');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  properties: native.properties.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold fixture properties, signatures and accessors', cold), summary('cached property identity and signature', warm)] }, null, 2));
