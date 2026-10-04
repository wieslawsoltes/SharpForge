import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { fieldFixture, fieldAuthority } from './fixtures/verifier-fields/input.js';
import { fieldCases } from './fixtures/verifier-fields/cases.js';
import { nativeCategoryInput } from './fixtures/a03-type-categories/native-input.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-type-categories/native.json', import.meta.url), 'utf8'));
const core = { coreTypes: nativeCategoryInput(capture).coreAuthority };
const fixture = name => fieldCases.find(value => value.name === name);
function verify(value, options = {}) {
  const input = fieldFixture(value);
  return verifyCilMethodTypes(input.bytes, input.method, { coreTypes: fieldAuthority(core, input), ...options });
}
const diagnostic = report => report.diagnostics[0]?.diagnostic;

test('real field receivers, stores, accessibility and nominal flow use pinned CoreLib canonical authority', () => {
  for (const value of fieldCases) {
    const report = verify(value);
    assert.equal(report.status, value.status, JSON.stringify({ name: value.name, report }));
    assert.equal(report.profile, 'SharpForge.TypedCIL.Fields/1', value.name);
  }
});

test('field type confusion, visibility and init-only stores have precise rejected diagnostics', () => {
  for (const name of ['LoadWrongReceiver', 'LoadNumericReceiver', 'LoadReferenceAddress', 'StoreWrongReceiver',
    'StoreWrongValue', 'StoreReferenceUnrelated', 'StoreStaticWrongValue', 'WrongReferenceReturn'])
    assert.equal(diagnostic(verify(fixture(name))), 'StackUnexpected', name);
  for (const name of ['LoadPrivateOutside', 'LoadProtectedBaseReceiver'])
    assert.equal(diagnostic(verify(fixture(name))), 'FieldAccess', name);
  for (const name of ['StoreInitOnlyOutside', 'StoreInitOnlyNormalInstance', 'StoreStaticInitOnlyOutside',
    'StoreStaticInitOnlyWrongCctor', 'AddressInitOnly'])
    assert.equal(diagnostic(verify(fixture(name))), 'InitOnly', name);
  assert.equal(diagnostic(verify(fixture('LoadStaticMismatch'))), 'ExpectedStaticField');
  assert.equal(diagnostic(verify(fixture('StoreValueCopyUnknown'))), 'ValueReceiverAddressUnavailable');
});

test('missing authority, same-module and absent module facts never turn unknown ancestry into rejection', () => {
  const input = fieldFixture(fixture('LoadWrongReceiver'));
  assert.equal(verifyCilMethodTypes(input.bytes, input.method).status, 'unknown');
  for (const sameModule of [true, undefined]) {
    const coreTypes = { ...fieldAuthority(core, input), sameModule };
    const report = verifyCilMethodTypes(input.bytes, input.method, { coreTypes });
    assert.equal(report.status, 'unknown');
    assert.equal(diagnostic(report), 'MetadataUnavailable');
  }
  const authority = fieldAuthority(core, input);
  const coreTypes = { ...authority, resolveType(token) {
    return token === input.tokens.object ? { status: 'unknown', reason: 'not-prepared' } : authority.resolveType(token);
  } };
  assert.equal(verifyCilMethodTypes(input.bytes, input.method, { coreTypes }).status, 'unknown');
});

test('normal instances are verified but instance constructors and malformed constructor lookalikes are not', () => {
  assert.equal(verify(fixture('NormalThisLoad')).status, 'verified');
  assert.equal(verify(fixture('ValueThisLoad')).status, 'verified');
  const constructor = { ...fixture('NormalThisLoad'), methodName: '.ctor', flags: 0x1886 };
  assert.equal(diagnostic(verify(constructor)), 'ConstructorStateUnavailable');
  for (const flags of [0x91, 0x891, 0x1091]) {
    const lookalike = { ...fixture('StoreStaticInitOnlyCctor'), flags };
    assert.equal(diagnostic(verify(lookalike)), 'InitOnly');
  }
  const convention = verify({ ...fixture('NormalThisLoad'), flags: 0x96 });
  assert.equal(convention.status, 'rejected');
  assert.equal(convention.diagnostics[0].code, 'CILVM0001');
});

test('nominal signatures require actual class/value categories and preserve unsupported normalization', () => {
  for (const parameters of [['valuetype Fixture.Owner'], ['class Fixture.Value']]) {
    const value = { name: 'TagMismatch', parameters, body: writer => writer.op('ret') };
    assert.equal(diagnostic(verify(value)), 'ClassValueTypeMismatch');
  }
  const value = { name: 'IntrinsicNominal', parameters: ['object'], result: 'class Fixture.Owner',
    body: writer => writer.op('ldarg.0').op('ret') };
  assert.equal(diagnostic(verify(value)), 'PrimitiveNominalRelationUnavailable');
  const byrefReturn = { ...value, result: 'int&' };
  assert.equal(verify(byrefReturn).status, 'unknown');
  const array = { ...value, parameters: ['int[]'], result: 'void', body: writer => writer.op('ret') };
  assert.equal(verify(array).status, 'unknown');
});

test('malformed field operands reject and unsupported storage/layout never qualifies', () => {
  const load = fixture('LoadOwner');
  const nonField = { ...load, body(writer, context) { writer.op('ldarg.0').op('ldfld', context.method).op('pop').op('ret'); } };
  assert.equal(diagnostic(verify(nonField)), 'ExpectedField');
  for (const [flags, expected] of [[0x46, 'LiteralField'], [0x106, 'FieldRvaUnavailable']]) {
    const value = { ...load, decorate(context) { context.builder.rows[4][0][0] = flags; } };
    assert.equal(diagnostic(verify(value)), expected);
  }
  const layout = { ...load, decorate(context) { context.builder.rows[2][1][0] |= 0x10; } };
  assert.equal(diagnostic(verify(layout)), 'ExplicitLayoutUnavailable');
  const byref = { ...load, decorate(context) {
    context.builder.rows[4][0][2] = context.builder.blob(Uint8Array.of(6, 16, 8));
  } };
  const malformed = verify(byref);
  assert.equal(malformed.status, 'rejected');
  assert.equal(malformed.diagnostics[0].code, 'CILVM0001');
  assert.equal(malformed.diagnostics[0].diagnostic, 'CILVM0001');
  assert.match(malformed.diagnostics[0].message, /Byref is invalid in this signature/);
});

test('nominal local stores compose existing definite assignment without constructor or alias shortcuts', () => {
  const assigned = { ...fixture('ReferenceLocal'), initLocals: false };
  assert.equal(verify(assigned).status, 'rejected');
  assert.equal(verify(assigned, { localInitialization: 'definite-assignment' }).status, 'verified');
  const unset = { ...assigned, body: writer => writer.op('ldloc.0').op('pop').op('ret') };
  assert.equal(diagnostic(verify(unset, { localInitialization: 'definite-assignment' })), 'UninitializedLocal');
  const wrong = { ...assigned, parameters: ['class Fixture.Other'] };
  assert.equal(diagnostic(verify(wrong, { localInitialization: 'definite-assignment' })), 'StackUnexpected');
});

test('metadata, graph, stack and cancellation budgets remain explicit unknowns through field verification', () => {
  const value = fixture('LoadOwner');
  for (const limits of [{ maxTypes: 0 }, { maxMembers: 0 }, { maxQueryNodes: 2 }, { maxDepth: 0 },
    { maxMemberSignatureNodes: 0 }, { maxTypedStackSlots: 0 }, { maxDataflowInstructions: 0 }])
    assert.equal(verify(value, limits).status, 'unknown', JSON.stringify(limits));
  assert.equal(verify(value, { signal: AbortSignal.abort() }).status, 'unknown');
  const input = fieldFixture(value);
  const controller = new AbortController();
  const authority = fieldAuthority(core, input);
  const coreTypes = { ...authority, resolveType(token) { controller.abort(); return authority.resolveType(token); } };
  const report = verifyCilMethodTypes(new AssemblyInspector(input.bytes), input.method, { coreTypes, signal: controller.signal });
  assert.equal(report.status, 'unknown');
  assert.equal(report.diagnostics[0].code, 'CILVT0003');
});
