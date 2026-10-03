import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeTypeSignature } from '@sharpforge/cil';
import { arrayContext } from './clr-types-array-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-constructed-types/native-arrays.json', import.meta.url)));

test('CLR array interfaces, accessor signatures and constructor arities match independent CoreCLR reflection', () => {
  assert.match(native.runtime, /^\.NET 10\./);
  const types = arrayContext().types;
  for (const expected of native.arrays) {
    let element = types.intrinsic(expected.name.startsWith('System.String') ? 'System.String' : 'System.Int32');
    if (expected.name.endsWith('[][]')) element = types.szArray(element);
    const type = expected.szarray ? types.szArray(element) : types.array(element, expected.rank);
    assert.equal(type.fullName, expected.name);
    assert.equal(type.baseType.fullName, expected.baseType);
    assert.deepEqual(type.interfaces.map(contract => contract.fullName).sort(), expected.interfaces);
    const actualMethods = type.methods.filter(method => method.name !== '.ctor').map(method => ({
      name: method.name, result: method.returnType.fullName, parameters: method.parameters.map(parameter => parameter.fullName),
    }));
    assert.deepEqual(actualMethods.sort((a, b) => a.name.localeCompare(b.name)),
      expected.methods.sort((a, b) => a.name.localeCompare(b.name)));
    assert.deepEqual(type.methods.filter(method => method.name === '.ctor').map(method => method.parameters.length).sort(),
      expected.constructors);
  }
  assert.equal(types.pointer(types.intrinsic('System.Int32')).fullName, native.pointerName);
  assert.equal(types.byRef(types.intrinsic('System.Int32')).fullName, native.byrefName);
});

test('CLR resolves a multidimensional constructor MemberRef emitted by the native C# compiler', async () => {
  const context = arrayContext();
  const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  const matches = [];
  for (let rid = 1; rid <= module.rowCount(10); rid++) {
    const token = 0x0a000000 + rid;
    const [parent, name] = module.row(token);
    if ((parent & 7) !== 4 || module.string(name) !== '.ctor') continue;
    const specification = module.row(0x1b000000 + (parent >>> 3));
    if (!['array', 'szarray'].includes(decodeTypeSignature(module.blob(specification[0])).kind)) continue;
    matches.push(await context.types.resolveArrayMember(module, token));
  }
  assert.ok(matches.some(method => method.declaringType.fullName === 'System.Int32[,]' && method.parameters.length === 2));
});
