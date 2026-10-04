import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPE } from '@sharpforge/cil';
import { AssemblyLoadSession, TypeKind, LoadErrorCode } from '../packages/clr/src/index.js';
import { managedFixture } from './managed-fixtures.js';
import { arrayContext } from './clr-types-array-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-generic-parameters/native-parameters.json', import.meta.url)));
const load = async image => (await new AssemblyLoadSession().createContext().loadFromStream(image)).manifestModule;

test('CLR type generic parameter identities match independent CoreCLR reflection and SRM metadata', async () => {
  const image = Buffer.from(native.image, 'base64');
  const module = await load(image);
  const other = await load(image);
  assert.match(native.runtime, /^\.NET 10\./);
  for (const expected of native.definitions) {
    const owner = module.typeDefinition(expected.token);
    assert.equal(owner.fullName, expected.name);
    assert.equal(owner.genericParameters, module.genericParameters(expected.token));
    assert.equal(owner.genericParameters.length, expected.parameters.length);
    for (const item of expected.parameters) {
      const type = module.genericParameter(item.token);
      assert.equal(type, owner.genericParameters[item.position]);
      assert.notEqual(type, other.genericParameter(item.token));
      assert.equal(type.kind, TypeKind.GenericParameter);
      assert.equal(type.name, item.name);
      assert.equal(type.namespace, item.namespace);
      assert.equal(type.fullName, item.fullName);
      assert.equal(String(type), item.text);
      assert.equal(type.genericParameterPosition, item.position);
      assert.equal(type.genericParameterAttributes, item.attributes);
      assert.equal(type.genericParameterOwner, owner);
      assert.equal(type.genericParameterOwner.fullName, item.owner);
      assert.equal(type.declaringType, owner);
      assert.equal(type.module, module);
      assert.equal(type.assembly, module.assembly);
      assert.equal(type.isLoaded, false);
      assert.deepEqual(type.genericParameterConstraintTokens, item.constraints);
      assert.ok(Object.isFrozen(type));
      assert.ok(Object.isFrozen(type.genericParameterConstraintTokens));
    }
    assert.ok(Object.isFrozen(owner.genericParameters));
  }
  assert.equal(module.methodBodyReadCount, 0);
  const methodParameter = module.genericParameter(native.methodParameter);
  assert.equal(methodParameter.name, 'V');
  assert.equal(methodParameter.declaringMethod.name, 'Method');
  assert.equal(methodParameter, methodParameter.declaringMethod.genericParameters[0]);
  const context = arrayContext();
  const typedModule = (await context.loadFromStream(image)).manifestModule;
  const parameter = typedModule.genericParameter(native.definitions[0].parameters[0].token);
  assert.throws(() => context.types.szArray(parameter), /requires generic type services/);
  assert.throws(() => context.types.functionPointer({ returnType: parameter }), /requires generic type services/);
});

test('CLR generic parameter metadata rejects invalid ownership, numbering, tokens and constraints', async () => {
  const invalid = async decorate => {
    const module = await load(managedFixture({ decorate }));
    return () => module.genericParameters(0x02000002);
  };
  const parameter = (md, position = 0, owner = 4) => md.add(42, [position, 0, owner, md.string('T')]);
  assert.throws(await invalid(({ md }) => { parameter(md, 0, 0); }), /Invalid GenericParam owner/);
  assert.throws(await invalid(({ md }) => { parameter(md, 1); }), /contiguous/);
  assert.throws(await invalid(({ md }) => { parameter(md); parameter(md); }), /Duplicate generic parameter position/);
  assert.throws(await invalid(({ md }) => { parameter(md, 1024); }), error => error.code === LoadErrorCode.LimitExceeded);
  assert.throws(await invalid(({ md }) => {
    parameter(md); md.add(44, [1, 0]);
  }), /Invalid generic constraint type/);
  assert.throws(await invalid(({ md }) => {
    parameter(md); md.add(44, [1, 7]);
  }), error => error.code === LoadErrorCode.InvalidImage);
  assert.throws(await invalid(({ md }) => {
    parameter(md); md.add(44, [2, 8]);
  }), /Invalid GenericParamConstraint owner/);
  assert.throws(await invalid(({ md }) => {
    parameter(md); md.add(44, [1, 8]); md.add(44, [1, 8]);
  }), /Duplicate generic parameter constraint/);
  const module = await load(managedFixture());
  for (const token of [0, 0x02000002, 0x2a000001, 0x12a000001, 42.5]) {
    assert.throws(() => module.genericParameter(token), error => error.code === LoadErrorCode.InvalidImage);
  }
});

test('CLR generic parameter positions are ordered independently of #- physical row order and preserve empty owners', async () => {
  const image = managedFixture({ decorate({ md }) {
    md.uncompressed = true;
    md.add(42, [1, 0, 4, md.string('Second')]);
    md.add(42, [0, 0, 4, md.string('First')]);
  } });
  // The public builder canonicalizes rows. Reverse the physical #- rows after writing to exercise the reader boundary.
  const metadata = readPE(image, { inspection: true }).metadata;
  const tables = metadata.streams.get('#-');
  const [first, second] = metadata.rowOffsets[42];
  const row = tables.slice(first, second);
  tables.copyWithin(first, second, second + row.length);
  tables.set(row, second);
  const view = new DataView(tables.buffer, tables.byteOffset, tables.byteLength);
  view.setUint32(20, view.getUint32(20, true) & ~(1 << 10), true);
  const module = await load(image);
  assert.equal(module.row(0x2a000001)[0], 1);
  assert.deepEqual(module.genericParameters(0x02000002).map(type => type.name), ['First', 'Second']);
  assert.equal(module.genericParameter(0x2a000001), module.genericParameters(0x02000002)[1]);
  assert.deepEqual(module.genericParameters(0x02000001), []);
});
