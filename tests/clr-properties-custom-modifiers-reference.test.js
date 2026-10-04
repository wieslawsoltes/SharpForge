import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyLoadSession } from '../packages/clr/src/index.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-custom-modifiers/native-modifiers.json', import.meta.url)));
const members = {
  field: (module, record) => module.fieldDefinition(record.token),
  property: (module, record) => module.propertyDefinition(record.token),
  parameter: (module, record) => {
    const method = module.methodDefinition(record.token);
    return record.position < 0 ? method.returnParameter : method.parameters[record.position];
  },
  indexParameter: (module, record) => module.propertyDefinition(record.token).indexParameters[record.position],
};

test('CLR custom modifier kinds and reflection ordering match independent persisted Reflection.Emit/CoreCLR metadata', async () => {
  const module = (await new AssemblyLoadSession().createContext().loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  assert.match(native.runtime, /^\.NET 10\./);
  for (const record of native.records) {
    const member = members[record.kind](module, record);
    assert.deepEqual(member.requiredCustomModifierTokens.map(token => native.modifierNames[token]), record.required);
    assert.deepEqual(member.optionalCustomModifierTokens.map(token => native.modifierNames[token]), record.optional);
  }
  assert.equal(module.methodBodyReadCount, 0);
});
