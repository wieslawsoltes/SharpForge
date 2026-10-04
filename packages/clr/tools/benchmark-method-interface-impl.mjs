import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { interfaceContext } from '../../../tests/clr-methods-interface-impl-fixtures.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-method-interface-impl/native-method-bases.json', import.meta.url)));
const image = Buffer.from(native.image, 'base64');
const load = async () => (await interfaceContext().loadFromStream(image)).manifestModule;
function summary(name, samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: sorted[50], p95: sorted[95], p99: sorted[99], samples };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const module = await load();
  const start = performance.now();
  for (const record of native.records) await module.methodDefinition(record.token).getBaseDefinition();
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const record = native.records.find(record => record.token !== record.baseToken);
const method = module.methodDefinition(record.token);
const root = await method.getBaseDefinition();
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 1000; iteration++) {
    if (await method.getBaseDefinition() !== root) throw new Error('Noncanonical base method');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 1000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  records: native.records.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold interface MethodImpl base definitions', cold), summary('cached asynchronous base definition', warm)] }, null, 2));
