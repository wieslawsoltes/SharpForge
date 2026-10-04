import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {float, singleToInt32Bits, doubleToInt64Bits, int32BitsToSingle, int64BitsToDouble} from '@sharpforge/bytecode';
import {intrinsicDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const reference = JSON.parse(readFileSync(new URL('./fixtures/a05/bit-converter/native-reference.json', import.meta.url), 'utf8'));
const singlePatterns = [0, -2147483648, 1, 0x007fffff, 0x00800000, 0x3f800000, -1082130432, 0x7f7fffff, 0x7f800000, -8388608];
const doublePatterns = [0n, -(1n << 63n), 1n, 0x000fffffffffffffn, 0x0010000000000000n, 0x3ff0000000000000n,
  -4616189618054758400n, 0x7fefffffffffffffn, 0x7ff0000000000000n, -4503599627370496n];

for (const [name, patterns, decode, encode, kind] of [
  ['Single', singlePatterns, int32BitsToSingle, singleToInt32Bits, 'r4'],
  ['Double', doublePatterns, int64BitsToDouble, doubleToInt64Bits, 'r8']
]) test(`BitConverter ${name} round-trips signs, subnormals, finite endpoints and infinities`, () => {
  for (const pattern of patterns) {
    const value = decode(pattern);
    assert.equal(value.float, kind);
    assert(Object.isFrozen(value));
    assert.equal(encode(value), pattern, String(pattern));
  }
  assert(Object.is(decode(patterns[1]).value, -0));
});

test('BitConverter observes Single storage rounding and does not confuse bit casts with numeric casts', () => {
  assert.equal(singleToInt32Bits(float(16777217)), 0x4b800000);
  assert.equal(doubleToInt64Bits(float(1)), 0x3ff0000000000000n);
  assert.equal(int32BitsToSingle(0x3f800000).value, 1);
  assert.equal(int64BitsToDouble(0x3ff0000000000000n).value, 1);
  assert(Number.isNaN(int32BitsToSingle(0x7fc00000).value));
  assert(Number.isNaN(int64BitsToDouble(0x7ff8000000000000n).value));
  assert.equal(singleToInt32Bits(float(NaN)) & 0x7f800000, 0x7f800000);
  assert.notEqual(singleToInt32Bits(float(NaN)) & 0x007fffff, 0);
});

test('BitConverter exact MemberRef signatures reject invalid widths, return types and instance forms', () => {
  const descriptor = {kind: 'method', owner: 'System.BitConverter', name: 'SingleToInt32Bits',
    signature: {isStatic: true, parameters: ['float'], returnType: 'int', genericArity: 0, callingConvention: 0}};
  assert(intrinsicDefinition(descriptor));
  for (const signature of [{...descriptor.signature, parameters: ['double']}, {...descriptor.signature, returnType: 'long'},
    {...descriptor.signature, isStatic: false}, {...descriptor.signature, parameters: []}, {...descriptor.signature, genericArity: 1}]) {
    assert.equal(intrinsicDefinition({...descriptor, signature}), null);
  }
  const invalid = managedFixture({methods: [{name: 'Main', result: 'int', body(w, c) {
    w.op('ldc.r8', 1).op('call', c.member('System.BitConverter', 'SingleToInt32Bits', 'int', ['double'])).op('ret');
  }}]});
  assert.throws(() => new CilVirtualMachine(invalid), /verification failed/);
});

for (const [name, patterns, type, encode, decode] of [
  ['Single', singlePatterns, 'int', 'SingleToInt32Bits', 'Int32BitsToSingle'],
  ['Double', doublePatterns, 'long', 'DoubleToInt64Bits', 'Int64BitsToDouble']
]) test(`direct CIL ${name} inverse adapters preserve bit patterns through locals and calls`, () => {
  const floatingType = name === 'Single' ? 'float' : 'double';
  const bytes = managedFixture({methods: [{name: 'Main', parameters: [type], locals: [floatingType], result: type, body(w, c) {
    w.op('ldarg.0').op('call', c.member('System.BitConverter', decode, floatingType, [type])).op('stloc.0');
    w.op('ldloc.0').op('call', c.member('System.BitConverter', encode, type, [floatingType])).op('ret');
  }}]});
  for (const pattern of patterns) {
    const result = new CilVirtualMachine(bytes, {arguments: [pattern]}).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, pattern);
  }
});

const emitObservation = {
  single_precision: w => w.op('ldc.r4', 16777216).op('ldc.r4', 1).op('add'),
  double_negative_zero: w => w.op('ldc.r8', -0),
  double_remainder_zero: w => w.op('ldc.r8', -4).op('ldc.r8', 2).op('rem'),
  single_remainder_zero: w => w.op('ldc.r4', -4).op('ldc.r4', 2).op('rem'),
  double_remainder: w => w.op('ldc.r8', 3).op('ldc.r8', 2).op('rem'),
  single_overflow: w => w.op('ldc.r4', 3.4028234663852886e38).op('ldc.r4', 2).op('mul')
};

test('saved .NET oracle provenance is retained without recomputing native results', () => {
  const hash = text => createHash('sha256').update(text).digest('hex');
  assert.equal(hash(reference.source), reference.sourceSha256);
  assert.equal(hash(reference.stdout), reference.outputSha256);
});

for (const {id, line} of reference.observations) test('direct CIL IEEE observation matches saved .NET 10: ' + id, () => {
  const single = id.startsWith('single'), type = single ? 'int' : 'long';
  const bytes = managedFixture({methods: [{name: 'Main', result: type, body(w, c) {
    emitObservation[id](w);
    w.op('call', c.member('System.BitConverter', single ? 'SingleToInt32Bits' : 'DoubleToInt64Bits', type, [single ? 'float' : 'double'])).op('ret');
  }}]});
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(String(result.returnValue), reference.stdout.trimEnd().split('\n')[line - 1]);
});
