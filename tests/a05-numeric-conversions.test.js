import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {AssemblyInspector} from '@sharpforge/cil';
import {convert, float} from '../packages/runtime/src/execution/numeric-ops.js';
import {managedFixture} from './managed-fixtures.js';
import {floatingConversionCases, numericConversionCases, numericConversionFixture, numericConversionOutput} from './a05-numeric-fixtures.js';

test('A05 B01: conv.u8 zero-extends Int32 bit patterns and preserves Int64 width', () => {
  assert.equal(convert('conv.u8', -1), 4294967295n);
  assert.equal(convert('conv.u8', -2147483648), 2147483648n);
  assert.equal(convert('conv.u8', 4294967295), 4294967295n);
  assert.equal(convert('conv.u8', 0), 0n);
  assert.equal(convert('conv.u8', convert('conv.u4', float(3e9))), 3000000000n);
  assert.equal(convert('conv.i8', -1), -1n);
  assert.equal(convert('conv.u8', -1n), -1n);
  assert.equal(convert('conv.u8', float(-1)), 0n);
  assert.throws(() => convert('conv.ovf.u8', -1), {name: 'OverflowException'});
  assert.equal(convert('conv.ovf.u8.un', -1), 4294967295n);
});

test('A05 B01: uint locals widen to both ulong and long without sign extension', () => {
  // The CIL emitted for uint x = 0xffffffff; WriteLine((ulong)x); WriteLine((long)x).
  const bytes = managedFixture({methods: [{name: 'Main', result: 'void', locals: ['uint'], body(w, c) {
    w.op('ldc.i4.m1').op('stloc.0');
    for (const type of ['ulong', 'long']) w.op('ldloc.0').op('conv.u8').op('call', c.member('System.Console', 'WriteLine', 'void', [type]));
    w.op('ret');
  }}]});
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '4294967295\n4294967295\n');
});

for (const item of floatingConversionCases) test('A05 B02 .NET 10 floating conversion: ' + item.id, () => {
  const result = convert('conv.' + item.target, float(item.input, item.source === 'float' ? 'r4' : 'r8'));
  const displayed = item.target === 'u8' ? BigInt.asUintN(64, result) : item.target === 'u4' ? result >>> 0 : result;
  assert.equal(displayed, item.expected);
});

test('A05 B02: direct helper reproducer saturates without confusing Int32 bit patterns with F', () => {
  assert.equal(convert('conv.i8', 1e30), 9223372036854775807n);
  assert.equal(convert('conv.u8', 1e30), -1n);
  assert.equal(convert('conv.i8', -1e30), -9223372036854775808n);
  assert.equal(convert('conv.i8', NaN), 0n);
  assert.equal(convert('conv.u8', -1), 4294967295n);
  assert.equal(convert('conv.u8', float(-1)), 0n);
  assert.equal(convert('conv.u4', float(3e9)), -1294967296);
});

test('A05 B01/B02: independent managed IL preserves the public signed/unsigned conversion table', () => {
  const bytes = numericConversionFixture(), result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, numericConversionOutput);
  for (const item of numericConversionCases) {
    const input = item.source === 'uint' ? item.input >>> 0 : item.input;
    const invoked = new CilVirtualMachine(bytes, {methodToken: item.id, arguments: [input]}).run();
    assert.equal(invoked.state, 'terminated', invoked.fault?.stack);
    assert.equal(invoked.returnValue, item.expected, item.id);
  }
});

test('A05 native numeric fixture uses CLI primitive MethodDef and MemberRef signatures', () => {
  const inspector = new AssemblyInspector(numericConversionFixture()), metadata = inspector.metadata;
  const method = name => [...inspector.methods.values()].find(method => method.name === name);
  assert.deepEqual([...metadata.blob(metadata.row(method('uint_max_to_ulong').token)[4])], [0, 1, 0x0b, 0x09]);
  assert.deepEqual([...metadata.blob(metadata.row(method('single_i8_precision').token)[4])], [0, 1, 0x0a, 0x0c]);
  const members = method('Main').instructions.filter(instruction => instruction.name === 'call' && instruction.operand >>> 24 === 10).map(instruction => metadata.blob(metadata.row(instruction.operand)[2]));
  assert(members.some(signature => signature.length === 4 && signature[0] === 0 && signature[1] === 1 && signature[2] === 1 && signature[3] === 0x09), 'Console.WriteLine(uint) must use ELEMENT_TYPE_U4');
  assert(members.some(signature => signature.length === 4 && signature[0] === 0 && signature[1] === 1 && signature[2] === 1 && signature[3] === 0x0b), 'Console.WriteLine(ulong) must use ELEMENT_TYPE_U8');
  assert(method('single_i8_precision').implFlags & 8, 'Native conversion inputs must retain NoInlining');
});

test('A05 B02: checked conversions keep overflow faults rather than applying saturation', () => {
  for (const target of ['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'u8']) {
    for (const input of [1e30, -1e30, Infinity, -Infinity, NaN]) {
      assert.throws(() => convert('conv.ovf.' + target, float(input)), {name: 'OverflowException'});
    }
    const bytes = managedFixture({methods: [{name: 'Main', result: target.endsWith('8') ? 'long' : 'int', body: w => w.op('ldc.r8', 1e30).op('conv.ovf.' + target).op('ret')}]});
    const result = new CilVirtualMachine(bytes).run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'OverflowException');
  }
  assert.equal(convert('conv.ovf.i1', float(127.9)), 127);
  assert.equal(convert('conv.ovf.u1', float(-0.9)), 0);
  assert.equal(convert('conv.ovf.i8', float(2 ** 63 - 1024)), 9223372036854774784n);
  assert.throws(() => convert('conv.ovf.i8', float(2 ** 63)), {name: 'OverflowException'});
  assert.throws(() => convert('conv.ovf.u8', float(2 ** 64)), {name: 'OverflowException'});
});
