import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { graphContext } from '../../../tests/clr-types-graph-fixtures.js';

const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-type-graphs/native-graphs.json', import.meta.url)));
const bytes = Buffer.from(fixture.image, 'base64');
const context = graphContext();
const module = (await context.loadFromStream(bytes)).manifestModule;
const token = fixture.definitions.find(type => type.name === 'Fixture.Child').token;

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
  await measure('cold context, image and inheritance graph', async () => {
    const local = graphContext();
    const assembly = await local.loadFromStream(bytes);
    await local.types.load(assembly.manifestModule, token);
  }, 5),
  await measure('warm inheritance graph lookup', () => context.types.load(module, token), 100),
];
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
  cpu: cpus()[0]?.model, imageBytes: bytes.length, allocationCount: 'not measured', previousEquivalentImplementation: false, results }, null, 2));
