import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignature, readPE } from '@sharpforge/cil';
import { AssemblyLoadSession, RuntimeModule, LoadErrorCode } from '../packages/clr/src/index.js';
import { readCustomModifierTokens } from '../packages/clr/src/type-system/custom-modifiers.js';
import { managedFixture } from './managed-fixtures.js';

const int = Object.freeze({ kind: 'primitive', name: 'int' });
const modifier = (kind, token, element = int) => ({ kind, token, element });
const fixture = decorate => managedFixture({ fields: [{ name: 'Field' }],
  methods: [{ name: 'get_Item', result: 'int', parameters: ['int'], static: false, noBody: true }],
  decorate(context) {
    const { md } = context;
    const tokens = ['A', 'B', 'C', 'D'].map(name => md.typeRef('Modifiers.' + name));
    const mixed = modifier('modreq', tokens[0], modifier('modopt', tokens[1],
      modifier('modreq', tokens[2], modifier('modopt', tokens[3]))));
    md.rows[4][0][2] = md.blob(encodeSignature({ kind: 'field', type: mixed }));
    md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true,
      returnType: modifier('modreq', tokens[0]), parameters: [modifier('modreq', tokens[2])] }));
    md.add(23, [0, md.string('Item'), md.blob(encodeSignature({ kind: 'property', hasThis: true,
      returnType: mixed, parameters: [modifier('modopt', tokens[1])] }))]);
    md.add(21, [2, 1]);
    md.add(24, [2, 1, 3]);
    decorate?.({ ...context, tokens });
  },
});
const load = async decorate => (await new AssemblyLoadSession().createContext().loadFromStream(fixture(decorate))).manifestModule;
const invalid = error => error.code === LoadErrorCode.InvalidImage;

test('CLR field/property custom modifiers preserve duplicates and reverse each encoded kind in frozen cached lists', () => {
  let tokens;
  const pe = readPE(fixture(context => { tokens = context.tokens; }), { inspection: true });
  const blob = pe.metadata.blob;
  let reads = 0;
  pe.metadata.blob = index => { reads++; return blob(index); };
  const module = new RuntimeModule({ ensureUsable() {} }, pe);
  const field = module.fieldDefinition(0x04000001), property = module.propertyDefinition(0x17000001);
  assert.equal(reads, 0);
  for (const member of [field, property]) {
    const required = member.requiredCustomModifierTokens;
    const optional = member.optionalCustomModifierTokens;
    assert.deepEqual(required, [tokens[2], tokens[0]]);
    assert.deepEqual(optional, [tokens[3], tokens[1]]);
    assert.ok(Object.isFrozen(required));
    assert.ok(Object.isFrozen(optional));
    assert.equal(member.requiredCustomModifierTokens, required);
    assert.equal(member.optionalCustomModifierTokens, optional);
  }
  assert.equal(reads, 2);
  assert.equal(module.methodBodyReadCount, 0);
  const repeated = readCustomModifierTokens(modifier('modreq', tokens[0], modifier('modreq', tokens[0])), module);
  assert.deepEqual(repeated.required, [tokens[0], tokens[0]]);
});

test('CLR method return/argument modifiers use method signatures while projected index parameters use the property signature', async () => {
  let tokens;
  const module = await load(context => { tokens = context.tokens; });
  const method = module.methodDefinition(0x06000001);
  const projected = module.propertyDefinition(0x17000001).indexParameters[0];
  assert.deepEqual(method.returnParameter.requiredCustomModifierTokens, [tokens[0]]);
  assert.deepEqual(method.parameters[0].requiredCustomModifierTokens, [tokens[2]]);
  assert.equal(projected.signatureType, method.parameters[0].signatureType);
  assert.deepEqual(projected.requiredCustomModifierTokens, []);
  assert.deepEqual(projected.optionalCustomModifierTokens, [tokens[1]]);
  assert.equal(projected.optionalCustomModifierTokens, projected.optionalCustomModifierTokens);
  const empty = readCustomModifierTokens(int, module).required;
  assert.equal(projected.requiredCustomModifierTokens, empty);
  assert.equal(method.parameters[0].optionalCustomModifierTokens, empty);
});

test('CLR modifier queries stop before byref/array element modifiers and share immutable empty results', async () => {
  const module = await load(({ md, tokens }) => {
    md.rows[4][0][2] = md.blob(encodeSignature({ kind: 'field', type: { kind: 'szarray',
      element: modifier('modreq', tokens[0]) } }));
    md.rows[6][0][4] = md.blob(encodeSignature({ kind: 'method', hasThis: true, returnType: int,
      parameters: [{ kind: 'byref', element: modifier('modopt', tokens[1]) }] }));
  });
  const field = module.fieldDefinition(0x04000001);
  const parameter = module.methodDefinition(0x06000001).parameters[0];
  assert.deepEqual(field.requiredCustomModifierTokens, []);
  assert.deepEqual(parameter.optionalCustomModifierTokens, []);
  assert.equal(field.requiredCustomModifierTokens, parameter.requiredCustomModifierTokens);
  assert.ok(Object.isFrozen(field.requiredCustomModifierTokens));
});

test('CLR custom modifier token extents and absent property signature positions reject lazily', async () => {
  const outOfRange = await load(({ md }) => {
    md.rows[4][0][2] = md.blob(encodeSignature({ kind: 'field', type: modifier('modreq', 0x0100ffff) }));
  });
  const field = outOfRange.fieldDefinition(0x04000001);
  assert.equal(field.signature.kind, 'field');
  assert.throws(() => field.requiredCustomModifierTokens, invalid);
  const missing = await load(({ md }) => {
    md.rows[23][0][2] = md.blob(encodeSignature({ kind: 'property', hasThis: true, returnType: int, parameters: [] }));
  });
  const projected = missing.propertyDefinition(0x17000001).indexParameters[0];
  assert.equal(projected.signatureType.kind, 'modreq');
  assert.throws(() => projected.optionalCustomModifierTokens, invalid);
  for (const token of [0, 0x01000000, 0x06000001, 0x101000001, 1n]) {
    assert.throws(() => readCustomModifierTokens(modifier('modreq', token), { rowCount: () => 2 }), invalid);
  }
  assert.deepEqual(readCustomModifierTokens(modifier('modreq', 0x1b000001), { rowCount: () => 1 }).required, [0x1b000001]);
});

test('CLR modifier traversal bounds prefix depth and retains queries through cooperative unload', async () => {
  const module = { rowCount: () => 1 };
  let type = int;
  for (let index = 0; index < 64; index++) type = modifier('modreq', 0x02000001, type);
  assert.equal(readCustomModifierTokens(type, module).required.length, 64);
  assert.throws(() => readCustomModifierTokens(modifier('modopt', 0x02000001, type), module),
    error => error.code === LoadErrorCode.LimitExceeded);
  const context = new AssemblyLoadSession().createContext({ isCollectible: true });
  const assembly = await context.loadFromStream(fixture());
  const field = assembly.manifestModule.fieldDefinition(0x04000001);
  context.unload();
  assert.equal(field.requiredCustomModifierTokens.length, 2);
  await assert.rejects(context.loadFromStream(fixture()), error => error.code === LoadErrorCode.Disposed);
});
