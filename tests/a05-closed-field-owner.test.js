import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {handlers} from '../packages/runtime/src/execution/handlers/object-model.js';
import {tokenCacheFixture} from './support/token-cache-fixture.js';

function setup() {
  const fixture = tokenCacheFixture('int', {derived: true});
  const vm = new CilVirtualMachine(fixture.bytes);
  const integer = vm.heap.object('Box`1<int>', [42]);
  const text = vm.heap.object('Box`1<string>', [null]);
  const derived = vm.heap.object('DerivedBox', [17]);
  return {fixture, vm, integer, text, derived};
}

test('closed field references accept exact and derived receivers with stable warm metadata', () => {
  const {fixture, vm, integer, text, derived} = setup();
  const integerField = vm.field(fixture.members[0], integer);
  const textField = vm.field(fixture.members[1], text);
  const inherited = vm.field(fixture.members[0], derived);
  assert.equal(integerField.field.signature.type, 'int');
  assert.equal(textField.field.signature.type, 'string');
  assert.equal(inherited.field.signature.type, 'int');
  assert.equal(inherited.record.data[inherited.index], 17);
  assert.equal(vm.field(fixture.members[0], derived).field, inherited.field);
  assert.equal(vm.field(fixture.members[0], integer).field, integerField.field);
  // A FieldDef has no explicit closed owner and continues using its receiver context.
  assert.equal(vm.field(fixture.field, text).field.signature.type, 'System.String');
});

for (const opcode of ['ldfld', 'stfld', 'ldflda']) {
  test(`${opcode} rejects another closed owner before reading, writing or creating an address`, () => {
    const {fixture, vm, integer, text, derived} = setup();
    // Warm both legal instantiations first; the FieldDef token and slot are shared.
    vm.field(fixture.members[0], integer);
    vm.field(fixture.members[1], text);
    vm.field(fixture.members[0], derived);
    for (const [member, receiver] of [
      [fixture.members[0], text], [fixture.members[1], integer], [fixture.members[1], derived]
    ]) {
      const before = [...vm.heap.get(receiver).data];
      vm.push(receiver);
      if (opcode === 'stfld') vm.push(99);
      assert.throws(() => handlers.get(opcode)(vm, vm.top, {name: opcode, operand: member}),
        {name: 'InvalidProgramException', message: 'Field declaring type does not match the receiver'});
      assert.deepEqual(vm.heap.get(receiver).data, before);
      assert.equal(vm.top.stack.length, 0);
    }
  });
}

test('restored field caches retain closed-owner rejection and valid derived access', () => {
  const {fixture, vm, integer, text, derived} = setup();
  const before = vm.field(fixture.members[0], derived).field;
  vm.field(fixture.members[1], text);
  const snapshot = vm.snapshot();
  vm.restore(snapshot);
  assert.notEqual(vm.field(fixture.members[0], derived).field, before);
  assert.throws(() => vm.field(fixture.members[0], text), {name: 'InvalidProgramException'});
  assert.throws(() => vm.field(fixture.members[1], integer), {name: 'InvalidProgramException'});
  assert.equal(vm.field(fixture.members[0], derived).record.data[0], 17);
});
