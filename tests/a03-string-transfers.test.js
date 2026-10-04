import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AssemblyInspector, verifyCilMethodTypes } from '@sharpforge/cil';
import { nativeCategoryInput } from './fixtures/a03-type-categories/native-input.js';
import { literalFixture, literalAuthority } from './fixtures/verifier-literals/input.js';
import { literalCases } from './fixtures/verifier-literals/cases.js';

const capture = JSON.parse(readFileSync(new URL('./fixtures/a03-type-categories/native.json', import.meta.url), 'utf8'));
const core = { coreTypes: nativeCategoryInput(capture).coreAuthority };
const named = name => literalCases.find(fixture => fixture.name === name);
function verify(fixture, options = {}) {
  const input = literalFixture(fixture);
  const authority = fixture?.metadata ? { coreTypes: literalAuthority(core, input) } : {};
  return verifyCilMethodTypes(input.bytes, input.method, { ...authority, ...options });
}

test('string transfers compose primitive storage, reference branches and field policies', () => {
  for (const fixture of literalCases) {
    const report = verify(fixture);
    assert.equal(report.status, fixture.status, JSON.stringify({ name: fixture.name, report }));
    assert.equal(report.profile, fixture.metadata ? 'SharpForge.TypedCIL.Fields/1' : 'SharpForge.TypedCIL.Literals/1');
    if (fixture.diagnostic) assert.equal(report.diagnostics[0].diagnostic, fixture.diagnostic, fixture.name);
  }
});

test('literal preparation requires no nominal type authority or unrelated metadata budget', () => {
  const report = verify(named('StringReturn'), { maxTypes: 0, maxMembers: 0, maxQueryNodes: 0 });
  assert.equal(report.status, 'verified');
  assert.equal(report.peakStack, 1);
  const input = literalFixture(named('StaticStringStore'));
  assert.equal(verifyCilMethodTypes(input.bytes, input.method).status, 'unknown');
});

test('mixed field preparation keeps literal errors, offsets and limits independent of metadata authority', () => {
  for (const [name, offset] of [['StaticStringStore', 0], ['FieldBeforeLiteral', 6]]) {
    const fixture = { ...named(name), rawHeap: Uint8Array.of(0, 0) };
    const report = verify(fixture);
    assert.equal(report.status, 'rejected');
    assert.equal(report.profile, 'SharpForge.TypedCIL.Fields/1');
    assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
    assert.equal(report.diagnostics[0].offset, offset);
    const limited = verify(named(name), { maxStringLiterals: 0 });
    assert.equal(limited.status, 'unknown');
    assert.equal(limited.diagnostics[0].code, 'CILDF0001');
  }
});

test('String stores retain definite-assignment rules and diagnose incompatible storage', () => {
  const fixture = { ...named('StringLocal'), initLocals: false };
  assert.equal(verify(fixture).diagnostics[0].diagnostic, 'InitLocals');
  assert.equal(verify(fixture, { localInitialization: 'definite-assignment' }).status, 'verified');
  const unset = { ...fixture, body(writer, input) {
    writer.op('ldstr', input.literal('unused')).op('pop').op('ldloc.0').op('ret');
  } };
  const report = verify(unset, { localInitialization: 'definite-assignment' });
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'UninitializedLocal');
});

test('literal peak stack and rejected IL offsets follow the actual transfer', () => {
  assert.equal(verify({ ...named('Duplicate'), maxStack: 1 }).diagnostics[0].diagnostic, 'StackOverflow');
  assert.equal(verify({ ...named('StringReturn'), maxStack: 0 }).diagnostics[0].offset, 0);
  const report = verify(named('NumericReturn'));
  assert.equal(report.diagnostics[0].code, 'CILT0001');
  assert.equal(report.diagnostics[0].offset, 5);
});

test('raw verification avoids String display decoding and preserves later public cache identity', () => {
  const input = literalFixture({ text: 'a'.repeat(8192) + '\ud800' });
  const inspector = new AssemblyInspector(input.bytes);
  const describe = inspector.describeToken;
  let descriptions = 0;
  inspector.describeToken = function (token) {
    descriptions++;
    return describe.call(this, token);
  };
  assert.equal(verifyCilMethodTypes(inspector, input.method).status, 'verified');
  assert.equal(descriptions, 0);
  const described = inspector.getMethod(input.method);
  assert.equal(descriptions, 1);
  assert.equal(described.instructions[0].operandText, JSON.stringify('a'.repeat(8192) + '\ud800'));
  assert.equal(verifyCilMethodTypes(inspector, input.method).status, 'verified');
  assert.equal(inspector.getMethod(input.method), described);
  assert.equal(descriptions, 1);
});

test('preexisting display decoding does not bypass later heap validation or literal budgets', () => {
  const input = literalFixture({ text: 'A' });
  const inspector = new AssemblyInspector(input.bytes);
  inspector.getMethod(input.method);
  assert.equal(verifyCilMethodTypes(inspector, input.method, { maxStringLiterals: 0 }).status, 'unknown');
  const heap = inspector.metadata.streams.get('#US');
  heap[heap.length - 1] = 1;
  const report = verifyCilMethodTypes(inspector, input.method);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'StringOperand');
  heap[heap.length - 1] = 0;
  assert.equal(verifyCilMethodTypes(inspector, input.method).status, 'verified');
});

test('unsupported object operations remain explicit even when preceded by a valid literal', () => {
  const input = literalFixture({ result: 'void', body(writer, context) {
    writer.op('ldstr', context.literal('value')).op('pop').op('ldtoken', context.type).op('pop').op('ret');
  } });
  const report = verifyCilMethodTypes(input.bytes, input.method);
  assert.equal(report.status, 'unknown');
  assert.equal(report.diagnostics[0].diagnostic, 'UnsupportedOpcode');
});
