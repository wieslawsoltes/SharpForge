import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeKind, LoadErrorCode, resolveArrayMethod } from '../packages/clr/src/index.js';
import { arrayContext, arrayMembers } from './clr-types-array-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

test('CLR constructed elements preserve rank, vector identity and exact accessor signatures', () => {
  const types = arrayContext().types;
  const integer = types.intrinsic('System.Int32');
  const vector = types.szArray(integer);
  assert.equal(vector, types.szArray(integer));
  assert.notEqual(vector, types.array(integer, 1));
  assert.equal(types.array(integer, 1).fullName, 'System.Int32[*]');
  assert.equal(types.array(integer, 32).rank, 32);
  assert.equal(vector.baseType, types.intrinsic('System.Array'));
  const list = vector.interfaces.find(type => type.fullName === 'System.Collections.Generic.IList`1[System.Int32]');
  assert.equal(list.genericArguments[0], integer);
  assert.equal(list.genericDefinition, types.intrinsic('System.Collections.Generic.IList`1'));
  assert.equal(list.isInterface, true);
  const md = types.array(integer, 2);
  assert.equal(md.fullName, 'System.Int32[,]');
  assert.equal(md.methods.filter(method => method.name === '.ctor').length, 2);
  assert.ok(md.methods.every(method => method.declaringType === md));
  const constructorArities = type => type.methods.filter(method => method.name === '.ctor').map(method => method.parameters.length);
  assert.deepEqual(constructorArities(types.szArray(types.szArray(vector))), [1, 2, 3]);
  assert.deepEqual(constructorArities(types.szArray(md)), [1]);
  assert.equal(resolveArrayMethod(md, 'Get', integer, [integer, integer]).returnType, integer);
  assert.throws(() => resolveArrayMethod(md, 'Get', integer, [integer]), /does not exist/);
  assert.equal(types.pointer(integer), types.pointer(integer));
  assert.equal(types.byRef(integer).fullName, 'System.Int32&');
  for (const rank of [0, 33, 1.1]) assert.throws(() => types.array(integer, rank), error => error.code === LoadErrorCode.TypeLoad);
  assert.throws(() => types.szArray(types.byRef(integer)), /Invalid szarray/);
  assert.throws(() => types.szArray(types.intrinsic('System.Void')), /Invalid szarray/);
  assert.throws(() => types.byRef(types.byRef(integer)), /Invalid byref/);
  const bounded = arrayContext({ typeOptions: { maxConstructedTypes: 1 } }).types;
  assert.throws(() => bounded.szArray(bounded.intrinsic('System.Int32')), error => error.code === LoadErrorCode.LimitExceeded);
});

test('CLR function pointer identity includes every calling convention field', () => {
  const types = arrayContext().types;
  const integer = types.intrinsic('System.Int32');
  const fn = types.functionPointer({ returnType: integer, parameters: [integer] });
  assert.equal(fn.kind, TypeKind.FunctionPointer);
  assert.equal(fn, types.functionPointer({ returnType: integer, parameters: [integer] }));
  assert.notEqual(fn, types.functionPointer({ returnType: integer, parameters: [integer], callingConvention: 1 }));
  assert.throws(() => types.functionPointer({ returnType: integer, callingConvention: 6 }), /Invalid function pointer/);
  assert.throws(() => types.functionPointer({ returnType: integer, parameters: [types.intrinsic('System.Void')] }), /cannot be void/);
  assert.ok(Object.isFrozen(fn.signature.parameters));
});

test('CLR element constructions preserve the defining context of an explicitly shared type', async () => {
  const first = arrayContext();
  const second = arrayContext();
  const module = (await first.loadFromStream(managedFixture())).manifestModule;
  const element = await first.types.load(module, 0x02000002);
  const vector = first.types.szArray(element);
  assert.equal(vector, second.types.szArray(element));
  assert.equal(vector.loadContext, first);
  assert.equal(vector.module, module);
  assert.equal(vector.assembly, module.assembly);
  assert.equal(first.types.pointer(element), second.types.pointer(element));
});

test('CLR resolves multidimensional array constructor/accessor MemberRefs and rejects cyclic TypeSpecs', async () => {
  const context = arrayContext();
  const fixture = arrayMembers();
  const module = (await context.loadFromStream(fixture.image)).manifestModule;
  const resolve = token => context.types.resolveArrayMember(module, token);
  assert.equal((await resolve(fixture.constructor)).parameters.length, 2);
  assert.equal((await resolve(fixture.boundedConstructor)).parameters.length, 4);
  assert.equal((await resolve(fixture.accessor)).name, 'Get');
  await assert.rejects(resolve(0x02000002), /Expected MemberRef/);
  await assert.rejects(resolve(fixture.invalidConstructor), /default instance method/);
  await assert.rejects(context.types.resolveArrayMember(module, fixture.accessor, { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
  const cyclic = managedFixture({ name: 'CyclicSpec', decorate({ md }) {
    md.add(27, [md.blob(Uint8Array.of(0x12, 6))]);
  } });
  const cyclicModule = (await context.loadFromStream(cyclic)).manifestModule;
  await assert.rejects(context.types.load(cyclicModule, 0x1b000001), /Circular TypeSpec/);
});
