import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {intrinsicDefinition} from '@sharpforge/cil';
import {decimalParse, decimalBits, decimalFormat} from '@sharpforge/bytecode';
import {managedFixture} from './managed-fixtures.js';
import {decimalSignature as D, emitDecimal, decimalField, decimalArithmeticFixture} from './a05-decimal-fixtures.js';

function run(bytes, options) {
  const vm = new CilVirtualMachine(bytes, options), result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return {vm, result};
}
for (const [operation, left, right, expected] of [
  ['Add', [1, 1], [2, 1], '0.3'], ['Subtract', [110, 2], [2, 1], '0.90'],
  ['Multiply', [12, 1], [20, 1], '2.40'], ['Divide', [1], [3], '0.3333333333333333333333333333'],
  ['Remainder', [75, 1, true], [2], '-1.5']
]) test('direct CIL Decimal ' + operation, () => {
  assert.equal(run(decimalArithmeticFixture(operation, left, right)).vm.resultDisplay(), expected);
});

test('Decimal constructors, TryParse out, GetBits, instance calls and managed zero defaults', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'void', locals: [D], body(w, c) {
    const writeDecimal = c.member('System.Console', 'WriteLine', 'void', [D]);
    w.op('ldloc.0').op('call', writeDecimal);
    w.op('ldloca.s', 0).op('ldc.i4', 123).op('call', c.member('System.Decimal', '.ctor', 'void', ['int'], false));
    w.op('ldloca.s', 0).op('call', c.member('System.Decimal', 'ToString', 'string', [], false));
    w.op('call', c.member('System.Console', 'WriteLine', 'void', ['string']));
    for (const input of ['12.30', 'bad', '1e2']) {
      w.op('ldstr', 0x70000000 + c.md.userString(input)).op('ldloca.s', 0);
      w.op('call', c.member('System.Decimal', 'TryParse', 'bool', ['string', D + '&']));
      w.op('call', c.member('System.Console', 'WriteLine', 'void', ['bool']));
      w.op('ldloc.0').op('call', writeDecimal);
    }
    emitDecimal(w, c, 1230, 2);
    w.op('call', c.member('System.Decimal', 'GetBits', 'int[]', [D])).op('ldc.i4.3').op('ldelem.i4');
    w.op('call', c.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
  }}]});
  assert.equal(run(bytes).result.output, '0\n123\nTrue\n12.30\nFalse\n0\nFalse\n0\n131072\n');
});

test('Decimal boxing copies values, exact unboxing mutates only its box and survives GC', () => {
  const bytes = managedFixture({fields: [{name: 'Stored', type: D}], methods: [{name: 'Main', result: D, locals: [D, 'object', D + '[]'], body(w, c) {
    emitDecimal(w, c, 110, 2);
    w.op('stloc.0').op('ldloc.0').op('box', c.resolve('System.Decimal')).op('stloc.1');
    emitDecimal(w, c, 2);
    w.op('stloc.0').op('call', c.member('System.GC', 'Collect', 'void'));
    w.op('ldloc.1').op('call', c.member('System.Console', 'WriteLine', 'void', ['object']));
    w.op('ldloc.1').op('unbox', c.resolve('System.Decimal')).op('ldloc.0').op('stobj', c.resolve('System.Decimal'));
    w.op('ldloc.1').op('unbox.any', c.resolve('System.Decimal')).op('stsfld', c.fields.Stored);
    w.op('ldc.i4.1').op('newarr', c.resolve('System.Decimal')).op('stloc.2');
    w.op('ldloc.2').op('ldc.i4.0').op('ldelema', c.resolve('System.Decimal'));
    w.op('ldsflda', c.fields.Stored).op('cpobj', c.resolve('System.Decimal'));
    w.op('ldloc.2').op('ldc.i4.0').op('ldelem', c.resolve('System.Decimal')).op('ret');
  }}]});
  const {result, vm} = run(bytes);
  assert.equal(result.output, '1.10\n');
  assert.equal(vm.resultDisplay(), '2');
});

test('Decimal exact host values, zero arrays and immutable snapshot replay preserve scale', () => {
  const bytes = managedFixture({methods: [{name: 'Main', parameters: [D], locals: [D], result: D, body: w =>
    w.op('ldarg.0').op('stloc.0').op('ldloc.0').op('ret')}]});
  const vm = new CilVirtualMachine(bytes, {arguments: ['12.3000']});
  vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
  const value = vm.top.locals[0], saved = vm.snapshot();
  assert.ok(Object.isFrozen(value));
  assert.deepEqual(decimalBits(value), [123000, 0, 0, 262144]);
  vm.run();
  vm.restore(saved);
  assert.equal(vm.top.locals[0], value);
  assert.equal(decimalFormat(vm.run().returnValue), '12.3000');
  assert.throws(() => new CilVirtualMachine(bytes, {arguments: [12.3]}), /exact Decimal/);
  const array = managedFixture({methods: [{name: 'Main', result: D, body(w, c) {
    w.op('ldc.i4.1').op('newarr', c.resolve('System.Decimal')).op('ldc.i4.0').op('ldelem', c.resolve('System.Decimal')).op('ret');
  }}]});
  assert.deepEqual(run(array).result.returnValue, decimalParse('0'));
});

for (const [name, expected] of [['Zero', '0'], ['One', '1'], ['MinusOne', '-1'],
  ['MaxValue', '79228162514264337593543950335'], ['MinValue', '-79228162514264337593543950335']]) {
  test('Decimal readonly external constant ' + name, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: D, body: (w, c) => w.op('ldsfld', decimalField(c, name)).op('ret')}]});
    assert.equal(run(bytes).vm.resultDisplay(), expected);
  });
}
test('Decimal conversions preserve unsigned ranges and checked destination failures', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'ulong', body(w, c) {
    w.op('ldc.i8', -1n).op('call', c.member('System.Decimal', 'op_Implicit', D, ['ulong']));
    w.op('call', c.member('System.Decimal', 'op_Explicit', 'ulong', [D])).op('ret');
  }}]});
  assert.equal(run(bytes).result.returnValue, 18446744073709551615n);
  const invalid = managedFixture({methods: [{name: 'Main', result: 'byte', body(w, c) {
    emitDecimal(w, c, 256);
    w.op('call', c.member('System.Decimal', 'op_Explicit', 'byte', [D])).op('ret');
  }}]});
  assert.equal(new CilVirtualMachine(invalid).run().fault?.name, 'OverflowException');
});
for (const [operation, left, right, fault] of [
  ['Add', [79228162514264337593543950335n], [1], 'OverflowException'],
  ['Divide', [1], [0], 'DivideByZeroException'], ['Remainder', [1], [0], 'DivideByZeroException']
]) test('Decimal CIL fault ' + operation, () => {
  assert.equal(new CilVirtualMachine(decimalArithmeticFixture(operation, left, right)).run().fault?.name, fault);
});

test('Decimal intrinsic verification rejects wrong return types and readonly constant stores', () => {
  const descriptor = {kind: 'method', owner: 'System.Decimal', name: 'Add',
    signature: {isStatic: true, parameters: ['System.Decimal', 'System.Decimal'], returnType: 'double'}};
  assert.equal(intrinsicDefinition(descriptor), null);
  const bytes = managedFixture({methods: [{name: 'Main', result: 'void', body(w, c) {
    emitDecimal(w, c, 2);
    w.op('stsfld', decimalField(c, 'One')).op('ret');
  }}]});
  assert.throws(() => new CilVirtualMachine(bytes), /readonly/);
});

const reference = JSON.parse(readFileSync(new URL('./fixtures/a05/decimal/native-reference.json', import.meta.url), 'utf8'));
test('Decimal saved .NET oracle retains original source, output and provenance', () => {
  const hash = text => createHash('sha256').update(text).digest('hex');
  assert.equal(hash(reference.source), reference.sourceSha256);
  assert.equal(hash(reference.stdout), reference.outputSha256);
  const observations = [
    run(decimalArithmeticFixture('Add', [1, 1], [2, 1])).vm.resultDisplay(),
    run(decimalArithmeticFixture('Divide', [1], [3])).vm.resultDisplay()
  ];
  assert.deepEqual(observations, reference.stdout.split('\n').slice(0, 2));
});

test('Decimal constant addresses allow reads but cannot be mutated indirectly', () => {
  const read = managedFixture({methods: [{name: 'Main', result: D, body(w, c) {
    w.op('ldsflda', decimalField(c, 'One')).op('ldobj', c.resolve('System.Decimal')).op('ret');
  }}]});
  assert.equal(run(read).vm.resultDisplay(), '1');
  const write = managedFixture({methods: [{name: 'Main', result: 'void', body(w, c) {
    w.op('ldsflda', decimalField(c, 'One')).op('initobj', c.resolve('System.Decimal')).op('ret');
  }}]});
  assert.equal(new CilVirtualMachine(write).run().fault?.name, 'InvalidProgramException');
});
test('Decimal rounding and floating conversion use registered managed contracts', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'double', body(w, c) {
    emitDecimal(w, c, 1245, 3, true);
    w.op('ldc.i4.2').op('ldc.i4.1').op('call', c.member('System.Decimal', 'Round', D,
      [D, 'int', 'valuetype System.MidpointRounding']));
    w.op('call', c.member('System.Decimal', 'ToDouble', 'double', [D])).op('ret');
  }}]});
  assert.equal(run(bytes).result.returnValue, -1.25);
});
