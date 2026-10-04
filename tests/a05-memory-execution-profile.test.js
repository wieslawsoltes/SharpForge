import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, isExecutableOpcode, stackEffect, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyGenericType} from '../packages/cil/src/generic-profile.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture(body, options = {}) {
  return genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', body, ...options}]}]);
}

function report(bytes, accepted, code) {
  const result = verifyCilAssembly(bytes);
  assert.equal(result.success, accepted, JSON.stringify(result.issues));
  if (code) assert(result.issues.some(issue => issue.code === code), JSON.stringify(result.issues));
  return result;
}

function blockBody(writer, alignment = 1, reverse = false) {
  const prefixes = () => {
    if (reverse) writer.op('unaligned.', alignment).op('volatile.');
    else writer.op('volatile.').op('unaligned.', alignment);
  };
  writer.op('ldc.i4.8').op('localloc').op('stloc.0');
  writer.op('ldloc.0').op('ldc.i4.0').op('ldc.i4.8');
  prefixes();
  writer.op('initblk').op('ldloc.0').op('ldloc.0').op('ldc.i4.8');
  prefixes();
  writer.op('cpblk').op('ldc.i4.0').op('ret');
}

test('block memory admission retains exact three-operand stack effects and maxstack bounds', () => {
  for (const alignment of [1, 2, 4]) for (const reverse of [false, true]) {
    report(fixture(writer => blockBody(writer, alignment, reverse), {locals: ['void*'], maxStack: 3}), true);
  }
  report(fixture(writer => blockBody(writer), {locals: ['void*'], maxStack: 2}), false, 'IL_STACK');
  for (const opcode of ['cpblk', 'initblk']) {
    assert.deepEqual(stackEffect(null, null, {name: opcode}), [3, 0]);
    report(fixture(writer => writer.op('ldc.i4.0').op('ldc.i4.0').op(opcode).op('ldc.i4.0').op('ret')), false, 'IL_STACK');
  }
  for (const opcode of ['localloc', 'cpblk', 'initblk', 'unaligned.', 'readonly.']) assert.equal(isExecutableOpcode(opcode), true);
  for (const opcode of ['no.', 'callx']) assert.equal(isExecutableOpcode(opcode), false);
});

test('the shared execution profile admits a signature-compatible jmp and executes its target', () => {
  assert.equal(isExecutableOpcode('jmp'), true);
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('jmp', context.methods.get('Program.Target'))},
    {name: 'Target', result: 'int', body: writer => writer.op('ldc.i4', 42).op('ret')}
  ]}]);
  report(bytes, true);
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.returnValue, 42);
  } finally { vm.stop(); }
});

test('memory prefix admission reuses strict operand, duplicate and target validation', () => {
  report(fixture(writer => blockBody(writer, 3), {locals: ['void*']}), false, 'IL_PREFIX');
  report(fixture(writer => writer.op('ldc.i4.0').op('volatile.').op('volatile.').op('ldind.i4').op('ret')), false, 'IL_PREFIX');
  report(fixture(writer => writer.op('ldc.i4.0').op('unaligned.', 1).op('ret')), false, 'IL_PREFIX');
  report(fixture(writer => writer.op('ldc.i4.0').op('readonly.').op('ldind.i4').op('ret')), false, 'IL_PREFIX');
});

test('readonly accepts array addresses and prevents branch entry into the prefix group', () => {
  const body = (branch = false) => (writer, context) => {
    const element = context.resolve('System.Int32');
    writer.op('ldc.i4.1').op('newarr', element).op('ldc.i4.0');
    if (branch) writer.op('br.s', 'inside');
    writer.op('readonly.').mark('inside').op('ldelema', element).op('ldind.i4').op('ret');
  };
  report(fixture(body()), true);
  report(fixture(body(true)), false, 'IL_PREFIX');
  for (const result of ['int&', 'int']) {
    report(fixture((writer, context) => {
      const owner = context.typeSpec('int[,]');
      const address = context.member(owner, 'Address', result, ['int', 'int'], false);
      writer.op('ldnull').op('ldc.i4.0').op('ldc.i4.0').op('readonly.').op('call', address).op('pop').op('ldc.i4.0').op('ret');
    }), result === 'int&', result === 'int' ? 'IL_PREFIX' : undefined);
  }
});

test('pinned locals, native pointers and rectangular signatures retain metadata qualifiers', () => {
  const bytes = fixture(writer => writer.op('ldc.i4.0').op('ret'),
    {locals: ['byte[] pinned', 'int& pinned', 'void*', 'int[*]', 'int[-2...2,4...]']});
  const inspector = new AssemblyInspector(bytes);
  report(inspector, true);
  assert.deepEqual(inspector.getMethod(inspector.pe.entryPoint).locals,
    ['byte[] pinned', 'int& pinned', 'void*', 'int[*]', 'int[-2...2,4...]']);
  report(fixture(writer => writer.op('ldc.i4.0').op('ret'), {locals: ['int modreq(Unknown) pinned']}), false, 'IL_SIGNATURE');
  const context = {typeArguments: [], methodArguments: []};
  for (const type of ['int pinned', 'int modreq(Unknown)', 'int[] modreq(Unknown)', 'int[foo]', 'List`1<int*>']) {
    assert.throws(() => verifyGenericType(inspector, type, context), {name: 'CilError'});
  }
  for (const type of ['void*', 'int*&', 'int[*]', 'int[,]', 'int& modreq(System.Runtime.InteropServices.InAttribute)']) {
    assert.doesNotThrow(() => verifyGenericType(inspector, type, context));
  }
});

test('closed aggregate cpobj operands and generic variables still require valid instantiation context', () => {
  const cell = {name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
    fields: [{name: 'Value', type: '!0'}], methods: []};
  const bytes = genericCallFixture([cell, {name: 'Program', methods: [{name: 'Main', result: 'int',
    locals: ['valuetype Cell`1<string>', 'valuetype Cell`1<string>'], body(writer, context) {
      writer.op('ldloca.s', 0).op('ldloca.s', 1).op('cpobj', context.typeSpec('valuetype Cell`1<string>'));
      writer.op('ldc.i4.0').op('ret');
    }}]}]);
  report(bytes, true);
  report(fixture((writer, context) => writer.op('ldnull').op('ldnull').op('cpobj', context.typeSpec('!!0'))
    .op('ldc.i4.0').op('ret')), false, 'IL_TOKEN');
});
