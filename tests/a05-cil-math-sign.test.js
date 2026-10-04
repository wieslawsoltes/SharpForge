import test from 'node:test';
import assert from 'node:assert/strict';
import {float, int32BitsToSingle, int64BitsToDouble} from '@sharpforge/bytecode';
import {intrinsicDefinition} from '@sharpforge/cil';
import {CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {mathSign} from '../packages/runtime/src/execution/math-sign.js';
import {managedFixture} from './managed-fixtures.js';

const formats = [
  {type: 'sbyte', opcode: 'ldc.i4', values: [-128, -1, 0, 1, 127]},
  {type: 'short', opcode: 'ldc.i4', values: [-32768, -1, 0, 1, 32767]},
  {type: 'int', opcode: 'ldc.i4', values: [-2147483648, -1, 0, 1, 2147483647]},
  {type: 'long', opcode: 'ldc.i8', values: [-(1n << 63n), -1n, 0n, 1n, (1n << 63n) - 1n]},
  {type: 'float', opcode: 'ldc.r4', values: [-Infinity, -3.4028234663852886e38, -(2 ** -149), -0, 0,
    2 ** -149, 3.4028234663852886e38, Infinity]},
  {type: 'double', opcode: 'ldc.r8', values: [-Infinity, -Number.MAX_VALUE, -Number.MIN_VALUE, -0, 0,
    Number.MIN_VALUE, Number.MAX_VALUE, Infinity]}
];
const nanMessage = 'Function does not accept floating point Not-a-Number values.';
const descriptor = type => ({kind: 'method', owner: 'System.Math', name: 'Sign', signature: {
  isStatic: true, parameters: [type], returnType: 'int', genericArity: 0, callingConvention: 0
}});

function returningSign(type, opcode, value) {
  return managedFixture({methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op(opcode, value).op('call', context.member('System.Math', 'Sign', 'int', [type])).op('ret');
  }}]});
}

for (const {type, opcode, values} of formats) {
  test(`direct CIL Math.Sign(${type}) returns primitive Int32 for zero, boundaries and signed minima`, () => {
    for (const value of values) {
      const vm = new CilVirtualMachine(returningSign(type, opcode, value)), result = vm.run();
      const expected = value < 0 ? -1 : value > 0 ? 1 : 0;
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.returnValue, expected, `${type}: ${value}`);
      assert.equal(result.returnValue, expected);
      assert.equal(typeof vm.returnValue, 'number');
      assert(!Object.is(vm.returnValue, -0), 'Sign returns integer zero, never negative zero');
    }
  });

  test(`Math.Sign(${type}) result retains Int32 field, array, boxing and GC behavior`, () => {
    const bytes = managedFixture({fields: [{name: 'Selected', type: 'int'}], methods: [
      {name: 'Main', result: 'int', locals: ['int[]', 'object'], body(writer, context) {
        writer.op(opcode, values[0]).op('call', context.member('System.Math', 'Sign', 'int', [type]));
        writer.op('stsfld', context.fields.Selected);
        writer.op('ldc.i4.1').op('newarr', context.resolve('System.Int32')).op('stloc.0');
        writer.op('ldloc.0').op('ldc.i4.0').op('ldsfld', context.fields.Selected).op('stelem.i4');
        writer.op('ldloc.0').op('ldc.i4.0').op('ldelem.i4').op('box', context.resolve('System.Int32')).op('stloc.1');
        writer.op('call', context.member('System.GC', 'Collect', 'void'));
        writer.op('ldloc.1').op('call', context.member('System.Console', 'WriteLine', 'void', ['object']));
        writer.op('ldloc.1').op('unbox.any', context.resolve('System.Int32')).op('ret');
      }}
    ]});
    const result = new CilVirtualMachine(bytes).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, -1);
    assert.equal(result.output, '-1\n');
  });
}

test('Single Sign narrows the shared floating stack at the declared parameter boundary', () => {
  for (const value of [-Number.MIN_VALUE, Number.MIN_VALUE]) {
    assert.equal(mathSign('float', float(value)), 0);
    assert.equal(mathSign('double', float(value)), value < 0 ? -1 : 1);
    const vm = new CilVirtualMachine(returningSign('float', 'ldc.r8', value));
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 0);
  }
});

test('floating Sign raises managed ArithmeticException for either quiet-NaN sign', () => {
  for (const [type, values] of [
    ['float', [int32BitsToSingle(0x7fc12345), int32BitsToSingle(0xffc54321)]],
    ['double', [int64BitsToDouble(0x7ff8000000012345n), int64BitsToDouble(BigInt.asIntN(64, 0xfff8000000054321n))]]
  ]) {
    for (const value of values) {
      assert.throws(() => mathSign(type, value), fault =>
        fault instanceof ManagedFault && fault.name === 'ArithmeticException' && fault.message === nanMessage);
    }
  }
  for (const [type, opcode] of [['float', 'ldc.r4'], ['double', 'ldc.r8']]) {
    const result = new CilVirtualMachine(returningSign(type, opcode, NaN)).run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'ArithmeticException');
    assert.equal(result.fault.message, nanMessage);
  }
});

for (const [type, opcode] of [['float', 'ldc.r4'], ['double', 'ldc.r8']]) {
  test(`guest CIL catches ${type} Sign NaN as ArithmeticException with the CoreLib message`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body(writer, context) {
      writer.mark('try').op(opcode, NaN).op('call', context.member('System.Math', 'Sign', 'int', [type]));
      writer.op('pop').op('leave.s', 'done');
      writer.mark('catch').op('call', context.member('System.Exception', 'get_Message', 'string', [], false));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string']));
      writer.op('ldc.i4.1').op('stloc.0').op('leave.s', 'done');
      writer.mark('done').op('ldloc.0').op('ret');
    }, handlers(labels, context) {
      return [{start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
        handlerEnd: labels.get('done'), catchType: context.resolve('System.ArithmeticException')}];
    }}]});
    const result = new CilVirtualMachine(bytes).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 1);
    assert.equal(result.output, nanMessage + '\n');
  });
}

test('Sign admits only exact static signed and floating signatures with an Int32 result', () => {
  for (const {type} of formats) {
    const valid = descriptor(type);
    assert.equal(intrinsicDefinition(valid)?.implementation, 'mathSign');
    for (const owner of ['System.MathF', 'Other.Math']) assert.equal(intrinsicDefinition({...valid, owner}), null);
    for (const replacement of [{returnType: 'long'}, {returnType: 'double'}, {isStatic: false},
      {parameters: []}, {parameters: [type, type]}, {parameters: [type + '&']}, {genericArity: 1}, {callingConvention: 5}]) {
      assert.equal(intrinsicDefinition({...valid, signature: {...valid.signature, ...replacement}}), null);
    }
  }
  for (const type of ['byte', 'ushort', 'uint', 'ulong', 'char', 'bool', 'nint', 'nuint', 'object']) {
    assert.equal(intrinsicDefinition(descriptor(type)), null, type);
  }
  assert.equal(intrinsicDefinition(descriptor('System.Decimal'))?.implementation, 'decimal');
});

test('ordinary external CIL with a false Sign signature is rejected before execution', () => {
  for (const [owner, parameter, result, isStatic] of [
    ['System.Math', 'uint', 'int', true], ['System.Math', 'int', 'long', true],
    ['System.Math', 'int', 'int', false], ['Other.Math', 'int', 'int', true]
  ]) {
    const bytes = managedFixture({methods: [{name: 'Main', result, body(writer, context) {
      if (!isStatic) writer.op('ldnull');
      writer.op('ldc.i4.1').op('call', context.member(owner, 'Sign', result, [parameter], isStatic)).op('ret');
    }}]});
    assert.throws(() => new CilVirtualMachine(bytes), /verification failed/);
  }
});
