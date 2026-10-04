import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-contexts/native-contexts.json', import.meta.url)));
const context = new AssemblyLoadSession().defaultContext;
const module = (await context.loadFromStream(Buffer.from(fixture.images[0], 'base64'))).manifestModule;
const canonical = module.typeDefinition(0x02000002);
const samples = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (module.typeDefinition(0x02000002) !== canonical) throw new Error('Noncanonical result');
  }
  if (sample >= 10) samples.push((performance.now() - start) * 1000 / 10000);
}
samples.sort((left, right) => left - right);
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  operation: 'cached metadata TypeDesc lookup', unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99],
  allocationCount: 'not measured', previousEquivalentImplementation: false }, null, 2));
