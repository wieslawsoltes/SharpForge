import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

function fixture(kind) {
  const constructor = {name: '.ctor', static: false, body: writer => writer.op('ret')};
  const body = (name, result, flags = 0x1c6) => ({name, result: 'int', static: false, flags,
    body: writer => writer.op('ldc.i4', result).op('ret')});
  const types = [
    {name: 'IBase', flags: 0xa1, interface: true, methods: [body('Value', 1)]},
    {name: 'ILeft', flags: 0xa1, interface: true, interfaces: ['IBase'], methods: [body('LeftValue', 2)]},
    {name: 'IRight', flags: 0xa1, interface: true, interfaces: ['IBase'], methods: [body('RightValue', 3)]},
    {name: 'ILeaf', flags: 0xa1, interface: true, interfaces: ['ILeft', 'IRight'],
      methods: kind === 'specific' ? [body('LeafValue', 4)] : []},
    {name: 'Impl', interfaces: [kind === 'default' ? 'IBase' : 'ILeaf'],
      methods: [constructor, ...(kind === 'implicit' ? [body('Value', 5)] : kind === 'explicit' ? [body('Chosen', 6)] : [])]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      writer.op('newobj', context.methods.get('Impl..ctor'));
      writer.op('callvirt', context.methods.get('IBase.Value')).op('ret');
    }}]}
  ];
  return controlFixture(types, {decorate(context) {
    const map = (type, bodyName) => context.md.add(25, [context.types.get(type) & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get(type + '.' + bodyName)),
      codedIndex('MethodDefOrRef', context.methods.get('IBase.Value'))]);
    map('ILeft', 'LeftValue');
    map('IRight', 'RightValue');
    if (kind === 'specific') map('ILeaf', 'LeafValue');
    if (kind === 'explicit') map('Impl', 'Chosen');
  }});
}

for (const [kind, value] of [['default', 1], ['specific', 4], ['implicit', 5], ['explicit', 6]]) {
  test('T02.2 interface invocation selects ' + kind + ' implementation', () => {
    const result = new CilVirtualMachine(fixture(kind)).run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, value);
  });
}

test('T02.2 incomparable diamond is verified but throws the managed ambiguity exception on invocation', () => {
  const bytes = fixture('ambiguous');
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes);
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'System.Runtime.AmbiguousImplementationException');
});
