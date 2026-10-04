import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-event-definitions/native-events.json', import.meta.url)));
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
  for (const event of native.events) {
    const descriptor = module.eventDefinition(event.token);
    void descriptor.addMethod;
    void descriptor.removeMethod;
  }
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const event = module.eventDefinition(native.events[0].token);
const addMethod = event.addMethod;
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (module.eventDefinition(event.metadataToken).addMethod !== addMethod) throw new Error('Noncanonical event accessor');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  events: native.events.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold fixture events and accessors', cold), summary('cached event identity and accessor', warm)] }, null, 2));
