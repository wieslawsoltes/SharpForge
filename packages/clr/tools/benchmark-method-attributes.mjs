import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-method-attributes/native-method-attributes.json', import.meta.url)));
const image = Buffer.from(native.image, 'base64');
const load = async () => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
const names = ['isAbstract', 'isFinal', 'isVirtual', 'isHideBySig', 'isSpecialName', 'isPrivate',
  'isFamilyAndAssembly', 'isAssembly', 'isFamily', 'isFamilyOrAssembly', 'isPublic', 'callingConvention'];
function summary(name, samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: sorted[50], p95: sorted[95], p99: sorted[99], samples };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const module = await load();
  const start = performance.now();
  for (const record of native.records) {
    const method = module.methodDefinition(record.token);
    for (const name of names) void method[name];
  }
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const method = module.methodDefinition(native.records[0].token);
const convention = method.callingConvention;
const isPublic = method.isPublic;
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (method.callingConvention !== convention || method.isPublic !== isPublic) throw new Error('Unstable metadata properties');
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  records: native.records.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold fixture attributes and calling conventions', cold), summary('cached convention and visibility query', warm)] }, null, 2));
