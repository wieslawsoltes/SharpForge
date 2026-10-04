import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../src/index.js';

const native = JSON.parse(readFileSync(new URL('../../../tests/fixtures/clr-custom-modifiers/native-modifiers.json', import.meta.url)));
const image = Buffer.from(native.image, 'base64');
const load = async () => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;
const members = {
  field: (module, record) => module.fieldDefinition(record.token),
  property: (module, record) => module.propertyDefinition(record.token),
  parameter: (module, record) => {
    const method = module.methodDefinition(record.token);
    return record.position < 0 ? method.returnParameter : method.parameters[record.position];
  },
  indexParameter: (module, record) => module.propertyDefinition(record.token).indexParameters[record.position],
};
function summary(name, samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return { name, unit: 'microseconds/operation', median: sorted[50], p95: sorted[95], p99: sorted[99], samples };
}
const cold = [];
for (let sample = 0; sample < 100; sample++) {
  const module = await load();
  const start = performance.now();
  for (const record of native.records) {
    const member = members[record.kind](module, record);
    void member.requiredCustomModifierTokens;
    void member.optionalCustomModifierTokens;
  }
  cold.push((performance.now() - start) * 1000);
}
const module = await load();
const field = module.fieldDefinition(native.records.find(record => record.kind === 'field').token);
const required = field.requiredCustomModifierTokens;
const optional = field.optionalCustomModifierTokens;
const warm = [];
for (let sample = 0; sample < 110; sample++) {
  const start = performance.now();
  for (let iteration = 0; iteration < 10000; iteration++) {
    if (field.requiredCustomModifierTokens !== required || field.optionalCustomModifierTokens !== optional) {
      throw new Error('Noncanonical custom modifier lists');
    }
  }
  if (sample >= 10) warm.push((performance.now() - start) * 1000 / 10000);
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, arch: process.arch,
  records: native.records.length, allocationCount: 'not measured', previousEquivalentImplementation: false,
  results: [summary('cold fixture modifier queries', cold), summary('cached field required and optional modifier lists', warm)] }, null, 2));
