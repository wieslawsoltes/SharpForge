import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyCilMethodTypes, verificationType, VerificationKind as Kind } from '@sharpforge/cil';
import { signaturePrimitiveNodes } from '../packages/cil/src/metadata/signature-types.js';
import { transferMemoryInstruction } from '../packages/cil/src/verify/ops-memory.js';
import { memoryTransfers } from '../packages/cil/src/verify/memory-tables.js';
import { primitiveRelations, primitiveVerificationSlot } from '../packages/cil/src/verify/typed-signatures.js';
import { memoryCases, memoryFixture } from './fixtures/verifier-memory/input.js';

const token = 0x06000001;
const fixture = name => memoryCases.find(value => value.name === name);
const verify = (value, options) => verifyCilMethodTypes(memoryFixture(value), token, options);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('indirect opcodes check primitive storage, loaded results and stored values through the public verifier', () => {
  for (const value of memoryCases) {
    const report = verify(value);
    assert.equal(report.status, value.status, JSON.stringify({ name: value.name, report }));
  }
});

test('unresolved storage shapes are distinct from impossible stack or reference kinds', () => {
  for (const name of ['LoadWideInteger', 'LoadWideFloat', 'StoreWideInteger', 'StoreWideFloat', 'StoreReferenceOpcodeInteger']) {
    const report = verify(fixture(name));
    assert.equal(report.status, 'unknown');
    assert.equal(report.diagnostics[0].diagnostic, 'MemoryAccessShapeUnavailable', name);
  }
  assert.equal(verify(fixture('LoadReferenceFromInteger')).diagnostics[0].diagnostic, 'ExpectedReferenceType');
  for (const name of ['StoreObjectInString', 'StoreIntegerInLong', 'StoreFloatInInteger', 'LoadIntegerFromFloat'])
    assert.equal(verify(fixture(name)).diagnostics[0].diagnostic, 'StackUnexpected', name);
});

test('indirect addresses must be managed pointers and underflow retains precise instruction offsets', () => {
  for (const name of ['LoadUnmanagedAddress', 'StoreUnmanagedAddress'])
    assert.equal(verify(fixture(name)).diagnostics[0].diagnostic, 'ExpectedByRef', name);
  const load = verify(fixture('LoadUnderflow'));
  assert.equal(load.diagnostics[0].diagnostic, 'StackUnderflow');
  assert.equal(load.diagnostics[0].offset, 0);
  const store = verify(fixture('StoreUnderflow'));
  assert.equal(store.diagnostics[0].diagnostic, 'StackUnderflow');
  assert.equal(store.diagnostics[0].offset, 1);
});

function transfer(name, values) {
  const stack = values.slice();
  const state = { relations: primitiveRelations, pop: () => stack.pop(), push: value => stack.push(value),
    fail(diagnostic, message, unknown) { throw Object.assign(new Error(message ?? diagnostic), { diagnostic, unknown }); } };
  transferMemoryInstruction(memoryTransfers[name], { name }, state);
  return stack;
}

test('registered memory policy accepts readonly loads and rejects readonly stores without forging stack values', () => {
  const readonly = verificationType(Kind.ReadonlyPointer, signaturePrimitiveNodes.int);
  const integer = verificationType(Kind.Int32);
  assert.deepEqual(transfer('ldind.i4', [readonly]), [integer]);
  assert.throws(() => transfer('stind.i4', [readonly, integer]), { diagnostic: 'ReadOnlyIllegalWrite' });
  const string = verificationType(Kind.ReadonlyPointer, signaturePrimitiveNodes.string);
  assert.equal(transfer('ldind.ref', [string])[0], primitiveVerificationSlot(signaturePrimitiveNodes.string).value);
  assert.throws(() => transfer('stind.ref', [string, verificationType(Kind.Null)]), { diagnostic: 'ReadOnlyIllegalWrite' });
});

test('canonical slot reuse excludes lookalike primitive nodes and unresolved nominal pointees', () => {
  assert.equal(primitiveVerificationSlot({ ...signaturePrimitiveNodes.int }), null);
  const pointer = verificationType(Kind.ManagedPointer, Object.freeze({ token: 0x02000002 }));
  assert.throws(() => transfer('ldind.i4', [pointer]), { diagnostic: 'MemoryTypeUnavailable', unknown: true });
});

test('indirect operations compose with definite assignment without inventing initialization through aliases', () => {
  const unset = { ...fixture('LocalAddressRoundtrip'), initLocals: false };
  const report = verify(unset, { localInitialization: 'definite-assignment' });
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'UninitializedLocal');
  const assigned = { ...unset, body(writer) {
    writer.op('ldc.i4.0').op('stloc.0').op('ldloca.s', 0).op('ldc.i4.1').op('stind.i4');
    writer.op('ldloca.s', 0).op('ldind.i4').op('ret');
  } };
  assert.equal(verify(assigned, { localInitialization: 'definite-assignment' }).status, 'verified');
});

test('unsupported pointer lifetimes and prefixes remain unknown and existing cancellation/budgets apply', () => {
  const escape = { name: 'LocalEscape', result: 'int&', locals: ['int'],
    body: writer => writer.op('ldloca.s', 0).op('ret') };
  assert.equal(verify(escape).status, 'unknown');
  const prefixed = { ...fixture('LoadInteger'), body: writer => writer.op('ldarg.0').op('volatile.').op('ldind.i4').op('ret') };
  assert.equal(verify(prefixed).status, 'unknown');
  for (const options of [{ signal: AbortSignal.abort() }, { maxDataflowSteps: 0 }, { maxTypedStackSlots: 0 }])
    assert.equal(verify(fixture('LoadInteger'), options).status, 'unknown');
});

test('native observations retain exact inputs and declared policy differences without qualifying unknown shapes', () => {
  const capture = JSON.parse(readFileSync(new URL('./fixtures/verifier-memory/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.inputSHA256, hash(readFileSync(new URL('./fixtures/verifier-memory/input.js', import.meta.url))));
  assert.equal(capture.observations.length, memoryCases.length);
  for (const value of memoryCases) {
    const native = capture.observations.find(item => item.name === value.name);
    assert.equal(native.assemblySHA256, hash(memoryFixture(value)), value.name);
    assert.equal(native.policyStatus, value.status);
    assert.equal(native.oracle.accepted, value.nativeAccepted ?? value.status === 'verified', value.name);
    assert.equal(native.difference, value.difference ?? null);
    if (value.status === 'unknown' || native.oracle.accepted !== (value.status === 'verified')) assert.ok(value.difference, value.name);
  }
});
