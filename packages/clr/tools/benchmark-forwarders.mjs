import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { forwardingCorpus, forwardingContext } from '../../../tests/clr-forwarders-fixtures.js';

const images = forwardingCorpus();
const context = forwardingContext(images);
const facade = await context.loadFromAssemblyName('ForwardFacade');
const target = await context.loadFromAssemblyName('ForwardTarget');

async function measure(name, operation, iterations) {
  for (let index = 0; index < 20; index++) await operation();
  const samples = [];
  for (let sample = 0; sample < 100; sample++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) await operation();
    samples.push((performance.now() - start) * 1000 / iterations);
  }
  samples.sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: samples[50], p95: samples[95], p99: samples[99] };
}

const results = [
  await measure('cold facade, images and two forwarding hops', async () => {
    const local = forwardingContext(images);
    const assembly = await local.loadFromAssemblyName('ForwardFacade');
    await local.types.find(assembly.manifestModule, 'Fixture.Widget');
  }, 5),
  await measure('warm two-hop forwarded type lookup', () => context.types.find(facade.manifestModule, 'Fixture.Widget'), 100),
  await measure('warm direct definition name lookup', () => context.types.find(target.manifestModule, 'Fixture.Widget'), 100),
];
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, imageBytes: [...images.values()].reduce((sum, bytes) => sum + bytes.length, 0),
  allocationCount: 'not measured', previousEquivalentImplementation: false, results }, null, 2));
