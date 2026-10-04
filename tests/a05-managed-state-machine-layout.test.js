import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {managedValueLayout, sizeOfType, valueLayout, valueReferenceOffsets}
  from '../packages/runtime/src/execution/value-layout.js';
import {createValueFromFields} from '../packages/runtime/src/execution/value-types.js';
import {boxValue, unsafeUnboxValue} from '../packages/runtime/src/execution/boxing.js';
import {byteLayout} from '../packages/runtime/src/execution/explicit-layout.js';
import {cancelStackFrame, reserveStackFrame} from '../packages/runtime/src/execution/stack-budget.js';

const contract = 'System.Runtime.CompilerServices.IAsyncStateMachine';
const stateName = 'HandWrittenState`1';
const closed = stateName + '<int>';
const builder = 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder`1<!0>';

function fixture({implement = true, verifyAttach = true, fields, generic = 'int', extraTypes = []} = {}) {
  const owner = stateName + '<' + generic + '>';
  return genericCallFixture([{
    name: stateName, flags: 0x100101, base: 'System.ValueType', genericParameters: [{}],
    interfaces: implement ? [contract] : [],
    fields: fields ?? [{name: 'State', type: 'int'}, {name: 'Value', type: '!0'},
      {name: 'Keep', type: 'object'}, {name: 'Builder', type: builder}],
    methods: [{name: 'Advance', static: false, flags: 0x1e1, body: writer => writer.op('ret')},
      {name: 'Attach', static: false, flags: 0x1e1, parameters: [contract], body: writer => writer.op('ret')}]
  }, ...extraTypes, {name: 'Program', methods: [{name: 'Main', result: 'int',
    locals: ['valuetype ' + owner, 'valuetype ' + owner], body(writer, context) {
      const type = context.typeSpec('valuetype ' + owner);
      writer.op('ldloca.s', 0).op('call', context.member(type, 'Advance', 'void', [], false));
      if (verifyAttach) writer.op('ldloca.s', 0).op('ldnull')
        .op('call', context.member(type, 'Attach', 'void', [contract], false));
      writer.op('ldloc.1').op('pop').integer(42).op('ret');
    }}]}], {decorate(context) {
    if (!implement) return;
    for (const [body, name, parameters] of [['Advance', 'MoveNext', []], ['Attach', 'SetStateMachine', [contract]]]) {
      context.md.add(25, [context.types.get(stateName) & 0xffffff,
        codedIndex('MethodDefOrRef', context.methods.get(stateName + '.' + body)),
        codedIndex('MethodDefOrRef', context.member(contract, name, 'void', parameters, false))]);
    }
  }});
}

for (const nativeIntBits of [32, 64]) {
  test(`verified arbitrary-name async values use bounded managed storage at ${nativeIntBits} bits`, () => {
    const vm = new CilVirtualMachine(fixture(), {nativeIntBits, weakStringInterning: true});
    try {
      const table = vm.typeSystem.table(closed), layout = managedValueLayout(vm, table);
      assert.equal(table.flags.valueType, true);
      assert.equal(vm.typeSystem.types.get(table.definitionToken).flags & 0x18, 0);
      assert.equal(table.fields[1].type, vm.typeSystem.table('int'));
      assert.equal(table.fields[3].type.name, 'System.Runtime.CompilerServices.AsyncTaskMethodBuilder`1<System.Int32>');
      assert.equal(layout.size, nativeIntBits === 32 ? 16 : 24);
      assert.equal(layout.containsReferences, true);
      assert.equal(managedValueLayout(vm, table), layout, 'The closed managed layout is cached');
      const reference = vm.heap.string('retained in copied state');
      const value = createValueFromFields(vm, table, [3, 9, reference, vm.top.locals[0].fields[3]]);
      vm.dereference(vm.address('local', 0), true, value);
      vm.dereference(vm.address('local', 1), true, value);
      assert.notEqual(vm.top.locals[0], vm.top.locals[1]);
      const stateAddress = vm.address('field', 0, vm.address('local', 0));
      vm.dereference(stateAddress, true, 5);
      assert.equal(vm.dereference(stateAddress), 5);
      assert.equal(vm.top.locals[1].fields[0], 3);
      vm.dereference(vm.address('local', 0), true, createValueFromFields(vm, table,
        [0, 0, null, vm.top.locals[0].fields[3]]));
      vm.heap.collect();
      assert.equal(vm.heap.get(reference).data, 'retained in copied state');
      const snapshot = vm.snapshot();
      assert.equal(vm.run().returnValue, 42);
      vm.stop();
      vm.restore(snapshot);
      vm.heap.collect();
      assert.equal(vm.top.locals[1].fields[2].h, reference.h);
      const replay = vm.run();
      assert.equal(replay.state, 'terminated', replay.fault?.stack);
      assert.equal(replay.returnValue, 42);
    } finally { vm.stop(); }
  });
}

test('managed state storage never makes auto-layout bytes, sizeof or unsafe unboxing available', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const table = vm.typeSystem.table(closed);
    assert(managedValueLayout(vm, table).size > 0);
    const unsupported = {name: 'NotSupportedException', message: 'Managed layout is not implemented: auto-layout ' + table.name};
    for (const operation of [valueLayout, sizeOfType, valueReferenceOffsets, byteLayout]) {
      assert.throws(() => operation(vm, table), unsupported);
    }
    const reference = boxValue(vm, vm.top.locals[0], table);
    assert.equal(vm.heap.get(reference).data[0].valueType, table);
    assert.throws(() => unsafeUnboxValue(vm, reference, table), unsupported);
    assert.equal(managedValueLayout(vm, table).containsReferences, true, 'An ABI rejection does not poison managed admission');
  } finally { vm.stop(); }
});

test('auto-layout state requires the supported interface slots and verified bodies', () => {
  const imitation = {name: contract, interface: true, flags: 0xa1, methods: [
    {name: 'MoveNext', static: false, flags: 0x5c6},
    {name: 'SetStateMachine', static: false, flags: 0x5c6, parameters: [contract]}
  ]};
  for (const options of [{implement: false}, {verifyAttach: false}, {extraTypes: [imitation]}]) {
    assert.throws(() => new CilVirtualMachine(fixture(options)), {
      name: 'NotSupportedException', message: 'Managed layout is not implemented: auto-layout ' + closed.replace('<int>', '<System.Int32>')
    });
  }
});

test('managed state admission does not hide unsupported nested auto layouts or recursive value fields', () => {
  assert.throws(() => new CilVirtualMachine(fixture({
    generic: 'valuetype Payload', extraTypes: [{name: 'Payload', base: 'System.ValueType', flags: 0x100101,
      fields: [{name: 'Value', type: 'int'}], methods: []}]
  })), {name: 'NotSupportedException', message: 'Managed layout is not implemented: auto-layout Payload'});
  assert.throws(() => new CilVirtualMachine(fixture({fields: [{name: 'Self', type: 'valuetype ' + stateName + '<!0>'}]})), {
    name: 'TypeLoadException', message: 'Recursive value layout'
  });
});

test('auto-layout logical bytes are reserved before managed frame allocation', () => {
  const bytes = fixture(), vm = new CilVirtualMachine(bytes, {nativeIntBits: 64});
  try {
    const ticket = reserveStackFrame(vm, vm.top.method, 0);
    const charged = ticket.bytes;
    cancelStackFrame(ticket);
    assert(Number.isSafeInteger(charged) && charged >= 48);
    assert.throws(() => new CilVirtualMachine(bytes, {nativeIntBits: 64, maxStackBytes: charged - 1}), {
      name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'
    });
    const exact = new CilVirtualMachine(bytes, {nativeIntBits: 64, maxStackBytes: charged});
    try { assert.equal(exact.frames.length, 1); }
    finally { exact.stop(); }
  } finally { vm.stop(); }
});
