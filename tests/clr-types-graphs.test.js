import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codedIndex } from '@sharpforge/cil';
import { AssemblyLoadSession, LoadErrorCode } from '../packages/clr/src/index.js';
import { graphContext, cyclicGraph } from './clr-types-graph-fixtures.js';
import { managedFixture } from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-type-graphs/native-graphs.json', import.meta.url)));

test('CLR base/interface graphs, enum underlying types and nested ownership match CoreCLR reflection', async () => {
  assert.match(native.runtime, /^\.NET 10\./);
  assert.equal(native.definitions.length, 8);
  const context = graphContext();
  const module = (await context.loadFromStream(Buffer.from(native.image, 'base64'))).manifestModule;
  for (const expected of native.definitions) {
    const identity = module.typeDefinition(expected.token);
    const type = await context.types.load(module, expected.token);
    assert.equal(type, identity);
    assert.equal(type, await context.types.find(module, type.fullName));
    assert.deepEqual({ token: type.metadataToken, name: type.fullName, enclosing: type.declaringType?.fullName ?? null,
      kind: type.kind, baseType: type.baseType?.fullName ?? null, interfaces: type.interfaces.map(contract => contract.fullName).sort(),
      underlying: type.underlyingType?.fullName ?? null }, expected);
  }
  assert.equal(module.methodBodyReadCount, 0);
  const cycle = (await context.loadFromStream(cyclicGraph())).manifestModule;
  await assert.rejects(context.types.load(cycle, 0x02000002), error => error.managedType === native.cycleError);
});

test('CLR graph loading retains canonical shared identities and rejects invalid interfaces and cancellation', async () => {
  const context = graphContext();
  const module = (await context.loadFromStream(managedFixture())).manifestModule;
  const type = await context.types.load(module, 0x02000002);
  assert.equal(type, await graphContext().types.load(module, 0x02000002));
  assert.equal(type.baseType, context.types.intrinsic('System.Object'));
  await assert.rejects(context.types.load(module, 0x02000002, { signal: AbortSignal.abort() }),
    error => error.code === LoadErrorCode.Cancelled);
  const invalid = managedFixture({ name: 'BadInterface', decorate({ md }) {
    md.add(9, [2, codedIndex('TypeDefOrRef', md.typeRef('System.Object'))]);
  } });
  const badModule = (await context.loadFromStream(invalid)).manifestModule;
  await assert.rejects(context.types.load(badModule, 0x02000002), /does not name an interface/);
  const bounded = graphContext({ typeOptions: { maxMetadataRows: 1 } });
  const boundedModule = (await bounded.loadFromStream(managedFixture())).manifestModule;
  await assert.rejects(bounded.types.load(boundedModule, 0x02000002), error => error.code === LoadErrorCode.LimitExceeded);
  const sealed = managedFixture({ name: 'SealedBase', decorate({ md }) {
    md.rows[2][1][0] |= 0x100;
    md.add(2, [1, md.string('Child'), 0, codedIndex('TypeDefOrRef', 0x02000002), 1, 2]);
  } });
  const sealedModule = (await context.loadFromStream(sealed)).manifestModule;
  await assert.rejects(context.types.load(sealedModule, 0x02000003), /sealed or value type/);
  let wrongTypes;
  const wrong = new AssemblyLoadSession({ typeOptions: { resolveExternalType: () => wrongTypes.intrinsic('Wrong') } }).defaultContext;
  wrongTypes = wrong.types;
  wrongTypes.defineIntrinsic('Wrong');
  const wrongModule = (await wrong.loadFromStream(managedFixture())).manifestModule;
  await assert.rejects(wrong.types.load(wrongModule, 0x02000002), /returned Wrong for System.Object/);
});

test('CLR unresolved framework references and generic inheritance stay explicit diagnostics', async () => {
  const unconfigured = new AssemblyLoadSession().defaultContext;
  const module = (await unconfigured.loadFromStream(managedFixture())).manifestModule;
  await assert.rejects(unconfigured.types.load(module, 0x02000002), error => error.code === LoadErrorCode.MissingAssembly);
  const constructed = managedFixture({ name: 'ConstructedType', decorate({ md }) {
    const generic = md.typeRef('System.Collections.Generic.IList`1');
    md.add(27, [md.blob(Uint8Array.of(0x15, 0x12, ((generic & 0xffffff) << 2) | 1, 1, 8))]);
  } });
  const constructedModule = (await unconfigured.loadFromStream(constructed)).manifestModule;
  await assert.rejects(unconfigured.types.load(constructedModule, 0x1b000001), error => error.code === LoadErrorCode.MissingAssembly);
  const cyclic = managedFixture({ name: 'CyclicTypeRef', decorate({ md }) {
    md.rows[1][0][0] = 7;
  } });
  const cyclicModule = (await unconfigured.loadFromStream(cyclic)).manifestModule;
  await assert.rejects(unconfigured.types.load(cyclicModule, 0x01000001), /Circular TypeRef/);
  const reentrant = new AssemblyLoadSession({ typeOptions: { resolveExternalType: async request => {
    await Promise.resolve();
    return request.resolveType(request.module, 0x01000001);
  } } }).defaultContext;
  const reentrantModule = (await reentrant.loadFromStream(managedFixture())).manifestModule;
  await assert.rejects(reentrant.types.load(reentrantModule, 0x02000002), /Circular TypeRef/);
});
