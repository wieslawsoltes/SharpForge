import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const fixture = process.argv[2] ?? new URL('../../../tests/fixtures/clr-method-display/native.json', import.meta.url);
const native = JSON.parse(readFileSync(fixture));
const records = JSON.parse(native.execution.stdout).records;
const image = Buffer.from(native.image, 'base64');
const load = async () => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
function summary(name, samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: sorted[50], p95: sorted[95], p99: sorted[99], samples };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const module = await load();
  const start = performance.now();
  for (const record of records) module.methodDefinition(record.token).toString();
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const method = module.methodDefinition(records.find(record => record.name === 'Constructed').token);
const expected = method.toString();
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (method.toString() !== expected) throw new Error('Unstable method display');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  records: records.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold fixture method displays', cold), summary('cached method display', warm)] }, null, 2));
