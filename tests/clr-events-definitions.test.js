import test from 'node:test';
import assert from 'node:assert/strict';
import { codedIndex, propertySignature, readPE } from '@sharpforge/cil';
import { AssemblyLoadSession, EventDesc, RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { MetadataMemberDefinitions } from '../packages/clr/src/type-system/metadata-member-definitions.js';
import { MetadataAccessors } from '../packages/clr/src/type-system/metadata-accessors.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => managedFixture({ methods: [
  { name: 'Add', parameters: ['System.Action'], static: false, noBody: true },
  { name: 'Remove', parameters: ['System.Action'], static: false, noBody: true },
  { name: 'Raise', result: 'int', static: false, noBody: true },
  { name: 'Other', static: false, noBody: true },
], decorate(context) {
  const { md } = context;
  md.add(20, [0, md.string('Changed'), codedIndex('TypeDefOrRef', md.typeRef('System.Action'))]);
  md.add(18, [2, 1]);
  for (const [role, method] of [[8, 1], [16, 2], [32, 3], [4, 4]]) md.add(24, [role, method, 2]);
  decorate?.(context);
} });
const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(fixture(decorate))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;
const limited = error => error.code === LoadErrorCode.LimitExceeded;

test('CLR Event identities preserve unresolved type tokens and share canonical MethodSemantics links with Property', () => {
  const pe = readPE(fixture(context => {
    const { md } = context;
    md.add(23, [0, md.string('Value'), md.blob(propertySignature('int', [], false, context.resolve))]);
    md.add(21, [2, 1]);
    md.add(24, [2, 3, 3]);
  }), { inspection: true });
  const row = pe.metadata.row;
  let reads = 0;
  pe.metadata.row = token => { if (token >>> 24 === 24) reads++; return row(token); };
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  const event = module.eventDefinition(0x14000001);
  assert.ok(event instanceof EventDesc);
  assert.throws(() => new EventDesc({}), TypeError);
  assert.equal(event.name, 'Changed');
  assert.equal(event.declaringType, module.typeDefinition(0x02000002));
  assert.equal(event.eventTypeToken >>> 24, 1);
  assert.equal(module.eventDefinitions(0x02000002)[0], event);
  assert.equal(module.eventDefinitions(0x02000002), module.eventDefinitions(0x02000002));
  assert.ok(Object.isFrozen(event));
  assert.equal(reads, 0);
  assert.equal(event.addMethod, module.methodDefinition(0x06000001));
  assert.equal(event.removeMethod, module.methodDefinition(0x06000002));
  assert.equal(event.raiseMethod, module.methodDefinition(0x06000003));
  assert.deepEqual(event.otherMethods, [module.methodDefinition(0x06000004)]);
  assert.ok(Object.isFrozen(event.otherMethods));
  assert.equal(module.propertyDefinition(0x17000001).getMethod, event.raiseMethod);
  assert.equal(reads, 5, 'Property and Event reuse one MethodSemantics scan');
  assert.equal(module.eventAccessors(event.metadataToken), module.eventAccessors(event.metadataToken));
  assert.equal(module.methodBodyReadCount, 0);
});

test('CLR EventPtr lists preserve order, optional roles are null and context identities stay distinct', async () => {
  const module = await load(({ md }) => {
    md.add(20, [0, md.string('Second'), 0]);
    md.uncompressed = true;
    md.add(19, [2]);
    md.add(19, [1]);
    md.rows[24] = md.rows[24].slice(0, 2);
  });
  assert.deepEqual(module.eventDefinitions(0x02000002).map(event => event.name), ['Second', 'Changed']);
  const event = module.eventDefinition(0x14000001);
  assert.equal(event.raiseMethod, null);
  assert.deepEqual(event.otherMethods, []);
  assert.equal(module.eventDefinition(0x14000002).eventTypeToken, 0);
  assert.equal(module.eventDefinitions(0x02000001).length, 0);
  assert.notEqual(event, (await load()).eventDefinition(0x14000001));
});

test('CLR Event map ownership, type token extents and names are bounded', async () => {
  for (const decorate of [
    ({ md }) => { md.rows[18] = []; },
    ({ md }) => { md.rows[18][0][0] = 99; },
    ({ md }) => { md.add(18, [2, 2]); },
    ({ md }) => { md.add(18, [1, 1]); },
    ({ md }) => { md.rows[20][0][2] = 3; },
    ({ md }) => { md.rows[20][0][2] = 1; },
    ({ md }) => { md.rows[20][0][2] = 397; },
    ({ md }) => { md.add(20, [...md.rows[20][0]]); md.uncompressed = true; md.add(19, [1]); md.add(19, [1]); },
  ]) {
    const module = await load(decorate);
    assert.throws(() => module.eventDefinition(0x14000001), invalid);
  }
  const names = await load(({ md }) => { md.rows[20][0][1] = md.string('x'.repeat(4097)); });
  assert.throws(() => names.eventDefinition(0x14000001), limited);
  for (const table of [2, 18, 19, 20]) {
    const definitions = new MetadataMemberDefinitions({ rowCount: value => value === table ? 100001 : 0,
      row: () => [0, 0, 0] }, 'event');
    assert.throws(() => definitions.get(0x14000001), limited);
  }
});

test('CLR Event accessors reject invalid roles, duplicates, wrong owners and missing add/remove methods lazily', async () => {
  for (const decorate of [
    ({ md }) => { md.rows[24][0][0] = 2; },
    ({ md }) => { md.rows[24][0][1] = 99; },
    ({ md }) => { md.rows[24][0][2] = 4; },
    ({ md }) => { md.rows[24].splice(0, 1); },
    ({ md }) => { md.add(24, [...md.rows[24][0]]); },
    ({ md }) => { md.rows[2][1][5] = 2; },
  ]) {
    const event = (await load(decorate)).eventDefinition(0x14000001);
    assert.throws(() => event.addMethod, invalid);
  }
  const accessors = new MetadataAccessors({ eventDefinition: () => ({}), rowCount: () => 100001 });
  assert.throws(() => accessors.get(0x14000001, 20), limited);
  const module = await load();
  for (const token of [0, 0x17000001, 0x14000002, 0x114000001]) assert.throws(() => module.eventAccessors(token), invalid);
});

test('CLR Property accessor queries defer invalid Event role validation until Event links are requested', async () => {
  const module = await load(context => {
    const { md } = context;
    md.rows[24][0][0] = 2;
    md.add(23, [0, md.string('Value'), md.blob(propertySignature('int', [], false, context.resolve))]);
    md.add(21, [2, 1]);
    md.add(24, [2, 3, 3]);
  });
  assert.equal(module.propertyDefinition(0x17000001).getMethod, module.methodDefinition(0x06000003));
  assert.throws(() => module.eventDefinition(0x14000001).addMethod, invalid);
});

test('CLR retained Event metadata survives cooperative unload while the context rejects new loads', async () => {
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  const module = (await context.loadFromStream(fixture())).manifestModule;
  const event = module.eventDefinition(0x14000001);
  context.unload();
  assert.equal(event.addMethod, module.methodDefinition(0x06000001));
  assert.equal(event.module, module);
  await assert.rejects(context.loadFromStream(fixture()), error => error.code === LoadErrorCode.Disposed);
});
