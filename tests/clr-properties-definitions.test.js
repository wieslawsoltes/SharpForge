import test from 'node:test';
import assert from 'node:assert/strict';
import { propertySignature, codedIndex } from '@sharpforge/cil';
import { AssemblyLoadSession, PropertyDesc, LoadErrorCode } from '../packages/clr/src/index.js';
import { MetadataMemberDefinitions } from '../packages/clr/src/type-system/metadata-member-definitions.js';
import { MetadataPropertyAccessors } from '../packages/clr/src/type-system/metadata-property-accessors.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => managedFixture({ methods: [
  { name: 'Read', result: 'int', static: false, noBody: true },
  { name: 'Write', parameters: ['int'], static: false, noBody: true },
  { name: 'Other', static: false, noBody: true },
], decorate(context) {
  const { md } = context;
  md.add(23, [0, md.string('Value'), md.blob(propertySignature('int', [], false, context.resolve))]);
  md.add(21, [2, 1]);
  for (const [role, method] of [[2, 1], [1, 2], [4, 3]]) md.add(24, [role, method, codedIndex('HasSemantics', 0x17000001)]);
  decorate?.(context);
} });
const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(fixture(decorate))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;
const limited = error => error.code === LoadErrorCode.LimitExceeded;

test('CLR property identities retain lazy signatures, raw constants and canonical accessor methods', async () => {
  const module = await load(({ md }) => { md.definitions.constantValue({ Parent: 0x17000001, Type: 'int', Value: 11 }); });
  const property = module.propertyDefinition(0x17000001);
  assert.ok(property instanceof PropertyDesc);
  assert.throws(() => new PropertyDesc({}), TypeError);
  assert.ok(Object.isFrozen(property));
  assert.equal(property.name, 'Value');
  assert.equal(property.declaringType, module.typeDefinition(0x02000002));
  assert.equal(property.module, module);
  assert.equal(property.loadContext, module.assembly.loadContext);
  assert.equal(module.propertyDefinitions(0x02000002)[0], property);
  assert.equal(module.propertyDefinitions(0x02000002), module.propertyDefinitions(0x02000002));
  assert.equal(property.signature, property.signature);
  assert.equal(property.signature.kind, 'property');
  assert.equal(property.signature.returnType.name, 'int');
  assert.equal(property.isStatic, false);
  assert.ok(Object.isFrozen(property.signature.parameters));
  assert.deepEqual(property.constant, { type: 8, value: 11 });
  assert.equal(property.constant, module.constant(property.metadataToken));
  assert.equal(property.getMethod, module.methodDefinition(0x06000001));
  assert.equal(property.setMethod, module.methodDefinition(0x06000002));
  assert.deepEqual(property.otherMethods, [module.methodDefinition(0x06000003)]);
  assert.ok(Object.isFrozen(property.otherMethods));
  assert.equal(module.propertyAccessors(property.metadataToken), module.propertyAccessors(property.metadataToken));
  assert.equal(module.methodBodyReadCount, 0);
  assert.notEqual(property, (await load()).propertyDefinition(property.metadataToken));
});

test('CLR PropertyPtr order is preserved and absent accessor roles return explicit nulls', async () => {
  const module = await load(({ md }) => {
    md.add(23, [0, md.string('Second'), md.rows[23][0][2]]);
    md.uncompressed = true;
    md.add(22, [2]);
    md.add(22, [1]);
    md.rows[24] = [];
  });
  assert.deepEqual(module.propertyDefinitions(0x02000002).map(property => property.name), ['Second', 'Value']);
  const property = module.propertyDefinition(0x17000001);
  assert.equal(property.getMethod, null);
  assert.equal(property.setMethod, null);
  assert.deepEqual(property.otherMethods, []);
  assert.equal(property.constant, null);
  assert.equal(module.propertyDefinitions(0x02000001).length, 0);
});

test('CLR property map ownership, malformed signatures and bounded names/blobs reject deterministically', async () => {
  for (const decorate of [
    ({ md }) => { md.rows[21] = []; },
    ({ md }) => { md.rows[21][0][0] = 99; },
    ({ md }) => { md.add(21, [2, 2]); },
    ({ md }) => { md.add(21, [1, 1]); },
    ({ md }) => { md.add(23, [...md.rows[23][0]]); md.uncompressed = true; md.add(22, [1]); md.add(22, [1]); },
  ]) {
    const module = await load(decorate);
    assert.throws(() => module.propertyDefinition(0x17000001), invalid);
  }
  const wrong = (await load(({ md }) => { md.rows[23][0][2] = md.rows[6][0][4]; })).propertyDefinition(0x17000001);
  assert.equal(wrong.name, 'Value');
  assert.throws(() => wrong.signature, invalid);
  const huge = (await load(({ md }) => { md.rows[23][0][2] = md.blob(new Uint8Array(1024 * 1024 + 1)); })).propertyDefinition(0x17000001);
  assert.throws(() => huge.signature, limited);
  const names = await load(({ md }) => { md.rows[23][0][1] = md.string('x'.repeat(4097)); });
  assert.throws(() => names.propertyDefinition(0x17000001), limited);
});

test('CLR property accessor roles, method owners and metadata row limits are checked lazily', async () => {
  for (const decorate of [
    ({ md }) => { md.rows[24][0][0] = 3; },
    ({ md }) => { md.rows[24][0][1] = 99; },
    ({ md }) => { md.rows[24][0][2] = 0; },
    ({ md }) => { md.rows[24][0][2] = 5; },
    ({ md }) => { md.add(24, [...md.rows[24][0]]); },
    ({ md }) => { md.rows[2][1][5] = 2; },
  ]) {
    const property = (await load(decorate)).propertyDefinition(0x17000001);
    assert.throws(() => property.getMethod, invalid);
  }
  for (const table of [2, 21, 22, 23]) {
    const definitions = new MetadataMemberDefinitions({ rowCount: value => value === table ? 100001 : 0,
      row: () => [0, 0, 0] }, 'property');
    assert.throws(() => definitions.get(0x17000001), limited);
  }
  const accessors = new MetadataPropertyAccessors({ propertyDefinition: () => ({}), rowCount: () => 100001 });
  assert.throws(() => accessors.get(0x17000001), limited);
  const module = await load();
  for (const token of [0, 0x04000001, 0x17000002, 0x117000001]) assert.throws(() => module.propertyAccessors(token), invalid);
});

test('CLR retained property metadata remains usable during cooperative unloading while new loads are rejected', async () => {
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  const module = (await context.loadFromStream(fixture())).manifestModule;
  const property = module.propertyDefinition(0x17000001);
  context.unload();
  assert.equal(module.propertyDefinitions(0x02000002)[0], property);
  assert.equal(property.getMethod.declaringType, property.declaringType);
  await assert.rejects(context.loadFromStream(fixture()), error => error.code === LoadErrorCode.Disposed);
});
