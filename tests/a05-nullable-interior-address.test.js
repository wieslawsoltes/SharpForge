import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {nullableValue} from '../packages/runtime/src/execution/nullable-value.js';
import {createValueFromFields} from '../packages/runtime/src/execution/value-types.js';
import {NullableValueStep} from '../packages/runtime/src/execution/nullable-interior.js';

function fixture(engine) {
  let vm, slot, type;
  if (engine === 'cil') {
    type = 'System.Nullable`1<Counter>';
    vm = new CilVirtualMachine(genericCallFixture([
      {name: 'Counter', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Value', type: 'int'}], methods: []},
      {name: 'Program', methods: [{name: 'Main', locals: ['valuetype System.Nullable`1<valuetype Counter>'],
        body: writer => writer.op('ret')}]}]));
    slot = 0;
  } else {
    const compiled = compileToIL(`struct Counter { public int Value; }
      class Program { static void Main() { Counter? saved = default(Counter?); } }`);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    vm = new VirtualMachine(compiled.image);
    for (let steps = 0; steps < 32; steps++) {
      const method = vm.image.methods[vm.top.methodId];
      slot = method.locals.findIndex(local => local.name === 'saved');
      if (slot >= 0) { type = method.locals[slot].type; break; }
      vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    }
    assert.ok(slot >= 0, 'Enter the user frame containing nullable storage');
  }
  const table = vm.heap.methodTables.get(type);
  const payload = value => createValueFromFields(vm, table.nullableType, [value]);
  const present = value => nullableValue(vm, table, payload(value), true);
  vm.top.locals[slot] = present(7);
  return {vm, slot, table, payload, present};
}

for (const engine of ['source', 'cil']) {
  test(`${engine}: nullable payload interiors replace immutable wrappers and follow current enclosing storage`, () => {
    const {vm, slot, present} = fixture(engine);
    try {
      const outer = vm.address('local', slot), original = vm.dereference(outer);
      const payload = vm.address('field', NullableValueStep, outer);
      const field = vm.address('field', 0, payload);
      assert.deepEqual(field.path, [NullableValueStep, 0]);
      assert.ok(Object.isFrozen(payload) && Object.isFrozen(payload.path));
      vm.dereference(field, true, 13);
      assert.equal(vm.dereference(outer).value.fields[0], 13);
      assert.equal(original.value.fields[0], 7, 'immutable copied wrapper retains its original payload');
      vm.dereference(outer, true, present(29));
      assert.equal(vm.dereference(field), 29, 'interior path resolves replaced enclosing storage');
      vm.dereference(field, true, 31);
      assert.equal(vm.dereference(outer).value.fields[0], 31);
      vm.stop();
      assert.throws(() => vm.dereference(payload), {name: 'InvalidProgramException'});
    } finally { vm.stop(); }
  });

  test(`${engine}: nullable interiors reject absent, foreign, mismatched and readonly payload storage`, () => {
    const {vm, slot, table, payload} = fixture(engine), foreign = fixture(engine);
    try {
      const outer = vm.address('local', slot);
      const readonly = vm.address('field', NullableValueStep, vm.address('local', slot, null, {readonly: true}));
      assert.throws(() => vm.dereference(readonly, true, payload(9)), {name: 'InvalidProgramException'});
      assert.equal(vm.dereference(outer).value.fields[0], 7);
      assert.throws(() => foreign.vm.address('field', NullableValueStep, outer), {name: 'InvalidProgramException'});
      vm.top.locals[slot] = nullableValue(vm, table);
      assert.throws(() => vm.address('field', NullableValueStep, outer), {name: 'InvalidOperationException'});
      vm.top.locals[slot] = nullableValue(vm, 'System.Nullable`1<int>', 17, true);
      assert.throws(() => vm.address('field', NullableValueStep, outer), {name: 'InvalidProgramException'});
      vm.top.locals[slot] = Object.freeze({nullableType: table, hasValue: true, value: 17});
      assert.throws(() => vm.address('field', NullableValueStep, outer), {name: 'InvalidProgramException'});
    } finally { vm.stop(); foreign.vm.stop(); }
  });
}
