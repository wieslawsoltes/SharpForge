import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyCilMethodTypes } from '@sharpforge/cil';
import { initializationCases, initializationFixture } from './fixtures/verifier-initialization/input.js';

const options = Object.freeze({ localInitialization: 'definite-assignment' });
const token = 0x06000001;
const fixture = name => initializationCases.find(value => value.name === name);
const verify = (value, extra = {}) => verifyCilMethodTypes(initializationFixture(value), token, { ...options, ...extra });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('definite local assignment handles every reachable path, loops, switches and word boundaries', () => {
  for (const value of initializationCases) {
    const report = verify(value);
    assert.equal(report.status, value.accepted ? 'verified' : 'rejected', JSON.stringify({ name: value.name, report }));
  }
});

test('portable default keeps the InitLocals requirement and the opt-in policy records unset local offsets', () => {
  const bytes = initializationFixture(fixture('StoredLoad'));
  for (const policy of [undefined, 'portable']) {
    const report = verifyCilMethodTypes(bytes, token, { localInitialization: policy });
    assert.equal(report.status, 'rejected');
    assert.equal(report.diagnostics[0].diagnostic, 'InitLocals');
  }
  assert.equal(verify(fixture('StoredLoad')).status, 'verified');
  const read = verify(fixture('ReadUnset'));
  assert.equal(read.diagnostics[0].diagnostic, 'UninitializedLocal');
  assert.equal(read.diagnostics[0].offset, 0);
  assert.equal(verify(fixture('AddressUnset')).diagnostics[0].diagnostic, 'UninitializedLocal');
});

test('a failing store cannot initialize a local and argument stores do not alias local bits', () => {
  assert.equal(verify(fixture('StoreWrongType')).diagnostics[0].diagnostic, 'StackUnexpected');
  assert.equal(verify(fixture('StoreUnderflow')).diagnostics[0].diagnostic, 'StackUnderflow');
  assert.equal(verify(fixture('ArgumentStoreDoesNotAssignLocal')).diagnostics[0].diagnostic, 'UninitializedLocal');
});

test('successors own immutable facts and a join preserves only common assignments', () => {
  const value = { name: 'SnapshotIsolation', parameters: ['int'], locals: ['int', 'int'], body(writer) {
    writer.op('ldc.i4.1').op('stloc.0').op('ldarg.0').op('brtrue.s', 'right');
    writer.op('ldc.i4.2').op('stloc.1').op('br.s', 'join').mark('right').op('br.s', 'join');
    writer.mark('join').op('ldloc.0').op('pop').op('ldloc.1').op('pop').op('ret');
  } };
  const report = verify(value);
  assert.equal(report.status, 'rejected');
  assert.equal(report.diagnostics[0].diagnostic, 'UninitializedLocal');
  const common = { ...value, name: 'CommonAssignment', body(writer) {
    writer.op('ldc.i4.1').op('stloc.0').op('ldarg.0').op('brtrue.s', 'right');
    writer.op('ldc.i4.2').op('stloc.1').op('br.s', 'join').mark('right').op('br.s', 'join');
    writer.mark('join').op('ldloc.0').op('pop').op('ret');
  } };
  assert.equal(verify(common).status, 'verified');
});

test('assignment work has a lowering-only word budget and no allocation for initialized or unused locals', () => {
  for (const name of ['NoLocals', 'UnusedLocals', 'InitLocalsRead', 'InitLocalsAddress'])
    assert.equal(verify(fixture(name), { maxInitializationWords: 0 }).status, 'verified', name);
  for (const name of ['StoredLoad', 'WordBoundaries', 'DiamondBoth']) {
    const report = verify(fixture(name), { maxInitializationWords: 0 });
    assert.equal(report.status, 'unknown');
    assert.match(report.diagnostics[0].message, /initialization word-work budget/);
  }
  for (const limit of [-1, 1.5, NaN, Infinity, '1', 1000001])
    assert.equal(verify(fixture('NoLocals'), { maxInitializationWords: limit }).status, 'unknown');
  for (const policy of [null, true, 'unchecked'])
    assert.equal(verify(fixture('NoLocals'), { localInitialization: policy }).status, 'unknown');
  assert.equal(verify(fixture('StoredLoad'), { signal: AbortSignal.abort() }).status, 'unknown');
});

test('local assignment does not imply alias, unbound instance-category or byref-return verification', () => {
  const cases = [
    { name: 'AliasWrite', body: writer => writer.op('ldloca.s', 0).op('ldc.i4.1').op('stind.i4').op('ret') },
    { name: 'InstanceMethod', static: false, body: writer => writer.op('ret') },
    { name: 'PointerEscape', result: 'int&', body: writer => writer.op('ldloca.s', 0).op('ret') },
  ];
  for (const value of cases) assert.equal(verify(value).status, 'unknown', value.name);
  // Normal instances are supported with explicit core authority by a03-field-transfers.test.js.
  assert.equal(verify(cases[1]).diagnostics[0].diagnostic, 'MetadataUnavailable');
});

test('native captures preserve exact fixtures and explicitly permitted definite-assignment differences', () => {
  const input = new URL('./fixtures/verifier-initialization/input.js', import.meta.url);
  const capture = JSON.parse(readFileSync(new URL('./fixtures/verifier-initialization/native.json', import.meta.url), 'utf8'));
  assert.equal(capture.inputSHA256, hash(readFileSync(input)));
  assert.equal(capture.observations.length, initializationCases.length);
  for (const value of initializationCases) {
    const native = capture.observations.find(item => item.name === value.name);
    assert.equal(native.assemblySHA256, hash(initializationFixture(value)), value.name);
    assert.equal(native.policyAccepted, value.accepted);
    assert.equal(native.oracle.accepted, value.nativeAccepted ?? value.accepted, value.name);
    assert.equal(native.difference, value.difference ?? null);
    if (native.oracle.accepted !== value.accepted) assert.ok(value.difference, value.name);
  }
});
