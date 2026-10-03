import test from 'node:test';
import assert from 'node:assert/strict';
import { readPE } from '@sharpforge/cil';
import { AssemblyLoadSession, FieldDesc, RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { MetadataMemberDefinitions } from '../packages/clr/src/type-system/metadata-member-definitions.js';
import { MetadataConstants } from '../packages/clr/src/type-system/metadata-constants.js';
import { managedFixture } from './managed-fixtures.js';

const fixture = decorate => managedFixture({ fields: [{ name: 'Number' }, { name: 'Text', type: 'string', static: false }],
  methods: [{ name: 'Method', parameters: ['int'], noBody: true }], decorate });
const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(fixture(decorate))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;
const limited = error => error.code === LoadErrorCode.LimitExceeded;

test('CLR field identities own immutable lazy signatures and share raw constants with parameter metadata', async () => {
  const image = readPE(fixture(({ md }) => {
    md.rows[4][0][0] |= 0x40;
    md.definitions.constantValue({ Parent: 0x04000001, Type: 'int', Value: 7 });
    md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 8 });
  }), { inspection: true });
  const row = image.metadata.row;
  let constantRows = 0;
  image.metadata.row = token => { if (token >>> 24 === 11) constantRows++; return row(token); };
  const module = new RuntimeModule({ ensureUsable() {} }, image);
  const fields = module.fieldDefinitions(0x02000002);
  const field = fields[0];
  assert.ok(field instanceof FieldDesc);
  assert.throws(() => new FieldDesc({}), TypeError);
  assert.equal(field, module.fieldDefinition(0x04000001));
  assert.equal(fields, module.fieldDefinitions(0x02000002));
  assert.equal(field.declaringType, module.typeDefinition(0x02000002));
  assert.equal(field.module, module);
  assert.equal(field.assembly, module.assembly);
  assert.ok(Object.isFrozen(field));
  assert.ok(Object.isFrozen(fields));
  assert.equal(field.isStatic, true);
  assert.equal(field.isLiteral, true);
  assert.equal(field.isInitOnly, false);
  assert.equal(constantRows, 0);
  assert.equal(field.signature.kind, 'field');
  assert.equal(field.signature.type.name, 'int');
  assert.ok(Object.isFrozen(field.signature.type));
  assert.equal(field.signature, field.signature);
  assert.deepEqual(field.constant, { type: 8, value: 7 });
  assert.equal(field.constant, module.constant(field.metadataToken));
  assert.deepEqual(module.methodDefinition(0x06000001).parameters[0].constant, { type: 8, value: 8 });
  assert.equal(constantRows, 2, 'Field and Param reuse one Constant table scan');
  assert.equal(fields[1].constant, null);
  assert.equal(module.methodBodyReadCount, 0);
  assert.notEqual(field, (await load()).fieldDefinition(0x04000001));
});

test('CLR declared fields honor FieldPtr order and reject invalid or missing ownership', async () => {
  const module = await load(({ md }) => { md.uncompressed = true; md.add(3, [2]); md.add(3, [1]); });
  assert.deepEqual(module.fieldDefinitions(0x02000002).map(field => field.name), ['Text', 'Number']);
  assert.equal(module.fieldDefinitions(0x02000001).length, 0);
  for (const token of [0, 0x06000001, 0x04000003, 0x104000001]) assert.throws(() => module.fieldDefinition(token), invalid);
  for (const decorate of [
    ({ md }) => { md.uncompressed = true; md.add(3, [1]); md.add(3, [1]); },
    ({ md }) => { md.rows[2][0][4] = 2; md.rows[2][1][4] = 2; },
  ]) {
    const malformed = await load(decorate);
    assert.throws(() => malformed.fieldDefinitions(0x02000002), invalid);
  }
});

test('CLR field signatures and defaults diagnose malformed metadata lazily with bounded heaps', async () => {
  const wrongSignature = await load(({ md }) => { md.rows[4][0][2] = md.rows[6][0][4]; });
  const field = wrongSignature.fieldDefinition(0x04000001);
  assert.equal(field.name, 'Number');
  assert.throws(() => field.signature, invalid);
  const hugeSignature = await load(({ md }) => { md.rows[4][0][2] = md.blob(new Uint8Array(1024 * 1024 + 1)); });
  assert.throws(() => hugeSignature.fieldDefinition(0x04000001).signature, limited);
  const hugeName = await load(({ md }) => { md.rows[4][0][1] = md.string('x'.repeat(4097)); });
  assert.throws(() => hugeName.fieldDefinition(0x04000001), limited);
  for (const decorate of [
    ({ md }) => { md.rows[4][0][0] |= 0x8000; },
    ({ md }) => { md.definitions.constantValue({ Parent: 0x04000001, Type: 'int', Value: 1 }); md.rows[4][0][0] = 0; },
    ({ md }) => { md.definitions.constantValue({ Parent: 0x04000001, Type: 'int', Value: 1 }); md.add(11, [...md.rows[11][0]]); },
    ({ md }) => { md.rows[4][0][0] |= 0x8000; md.add(11, [8, 4, md.blob(Uint8Array.of(1))]); },
  ]) {
    const malformed = await load(decorate);
    assert.throws(() => malformed.fieldDefinition(0x04000001).constant, invalid);
  }
});

test('CLR Constant owner-table validation remains lazy and bounds ownership indexing before rows are read', async () => {
  const module = await load(({ md }) => {
    md.definitions.constantValue({ Parent: 0x08000001, Type: 'int', Value: 8 });
    md.add(11, [8, 400, md.blob(Uint8Array.of(0, 0, 0, 0))]);
  });
  assert.equal(module.methodDefinition(0x06000001).parameters[0].constant.value, 8);
  assert.throws(() => module.fieldDefinition(0x04000001).constant, invalid);
  for (const token of [0, 0x06000001, 0x04000003, 0x104000001]) assert.throws(() => module.constant(token), invalid);
  for (const table of [2, 3, 4]) {
    const definitions = new MetadataMemberDefinitions({ rowCount: value => value === table ? 100001 : 0,
      row: () => [0, 0, 0] }, 'field');
    assert.throws(() => definitions.get(0x04000001), limited);
  }
});

test('CLR direct Constant lookup bounds each owner table before retaining per-owner cache entries', () => {
  for (const table of [4, 8, 23]) {
    const constants = new MetadataConstants({ rowCount: value => value === table ? 100001 : 0,
      row: () => { throw new Error('Owner row read before its bound'); } });
    assert.throws(() => constants.get((table << 24) + 1), limited);
  }
});
