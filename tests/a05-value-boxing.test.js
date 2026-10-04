import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {boxValue, unboxValue} from '../packages/runtime/src/execution/boxing.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const point = {name: 'Point', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'X', type: 'int'}, {name: 'Tiny', type: 'byte'}], methods: []};
const other = {...point, name: 'Other'};

function fixture(body, {result = 'void', locals = ['valuetype Point', 'object', 'valuetype Point']} = {}) {
  return genericCallFixture([point, other, {name: 'Program', methods: [{name: 'Main', result, locals, body}]}]);
}

test('CIL user boxes copy values, expose a live interior and retain their exact type and default text', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), x = context.fields.get('Point.X'), tiny = context.fields.get('Point.Tiny');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    const text = context.member('System.Console', 'WriteLine', 'void', ['string']);
    const boolean = context.member('System.Console', 'WriteLine', 'void', ['bool']);
    writer.op('ldloca.s', 0).op('ldc.i4.7').op('stfld', x);
    writer.op('ldloc.0').op('box', type).op('stloc.1');
    writer.op('ldloc.1').op('unbox', type).op('ldc.i4.s', 9).op('stfld', x);
    writer.op('ldloc.1').op('unbox', type).op('ldflda', tiny).op('ldc.i4', 511).op('stind.i1');
    writer.op('ldloc.1').op('unbox.any', type).op('stloc.2');
    writer.op('ldloca.s', 2).op('ldc.i4.s', 11).op('stfld', x);
    writer.op('ldloc.0').op('ldfld', x).op('call', print);
    writer.op('ldloc.1').op('unbox.any', type).op('ldfld', x).op('call', print);
    writer.op('ldloc.2').op('ldfld', x).op('call', print);
    writer.op('ldloc.1').op('unbox.any', type).op('ldfld', tiny).op('call', print);
    writer.op('ldloc.1').op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('call', text);
    writer.op('ldloc.1').op('callvirt', context.member('System.Object', 'GetType', 'System.Type', [], false));
    writer.op('callvirt', context.member('System.Type', 'get_FullName', 'string', [], false)).op('call', text);
    writer.op('ldloc.1').op('isinst', context.resolve('System.ValueType')).op('ldnull').op('cgt.un').op('call', boolean);
    writer.op('ldloc.1').op('isinst', context.resolve('Other')).op('ldnull').op('cgt.un').op('call', boolean).op('ret');
  });
  for (const nativeIntBits of [32, 64]) {
    const vm = new CilVirtualMachine(bytes, {nativeIntBits});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '7\n9\n11\n255\nPoint\nPoint\nTrue\nFalse\n');
    } finally { vm.stop(); }
  }
});

test('CIL box interior alone keeps its owner alive during collection', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), x = context.fields.get('Point.X');
    writer.op('ldloc.0').op('box', type).op('unbox', type).op('stloc.1');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldloc.1').op('ldc.i4.s', 23).op('stfld', x);
    writer.op('ldloc.1').op('ldobj', type).op('ldfld', x).op('ret');
  }, {result: 'int', locals: ['valuetype Point', 'valuetype Point&']});
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 23);
    assert(vm.heap.stats.collections > 0);
  } finally { vm.stop(); }
});

for (const opcode of ['unbox', 'unbox.any']) {
  test(`CIL ${opcode} rejects null and a different same-layout user struct`, () => {
    for (const nullValue of [false, true]) {
      const bytes = fixture((writer, context) => {
        if (nullValue) writer.op('ldnull');
        else writer.op('ldloc.0').op('box', context.resolve('Point'));
        writer.op(opcode, context.resolve('Other')).op('pop').op('ret');
      });
      const vm = new CilVirtualMachine(bytes);
      try {
        const result = vm.run();
        assert.equal(result.state, 'faulted');
        assert.equal(result.fault.name, nullValue ? 'NullReferenceException' : 'InvalidCastException');
      } finally { vm.stop(); }
    }
  });
}

test('boxed payload snapshots stay immutable while interior addresses survive enclosing replacement', () => {
  const vm = new CilVirtualMachine(fixture(writer => writer.op('ret')));
  try {
    const original = vm.top.locals[0], boxed = boxValue(vm, original, 'Point');
    vm.top.locals[1] = boxed;
    const boxAddress = unboxValue(vm, boxed, 'Point', true), field = vm.address('field', 0, boxAddress);
    assert.notEqual(vm.heap.get(boxed).data[0], original);
    vm.dereference(field, true, 31);
    const snapshot = vm.snapshot();
    const copied = unboxValue(vm, boxed, 'Point');
    assert.notEqual(copied, vm.heap.get(boxed).data[0]);
    vm.dereference(boxAddress, true, original);
    vm.dereference(field, true, 47);
    assert.equal(copied.fields[0], 31);
    assert.equal(original.fields[0], 0);
    vm.restore(snapshot);
    assert.equal(vm.dereference(field), 31);
    vm.dereference(field, true, 53);
    assert.equal(snapshot.heap.records[boxed.h].data[0].fields[0], 31);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.dereference(field), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('boxed Int32 cannot be unboxed as Int64 after the aggregate extension', () => {
  const bytes = fixture((writer, context) => writer.op('ldc.i4.5').op('box', context.resolve('System.Int32'))
    .op('unbox.any', context.resolve('System.Int64')).op('ret'), {result: 'long', locals: []});
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().fault.name, 'InvalidCastException'); }
  finally { vm.stop(); }
});

test('boxing preserves registered framework copies and rejects a foreign user-value payload', () => {
  const vm = new CilVirtualMachine(fixture(writer => writer.op('ret')));
  const otherVM = new CilVirtualMachine(fixture(writer => writer.op('ret')));
  try {
    const original = vm.heap.allocate('host', 'Microsoft.UI.Xaml.Thickness', [2, 3, 4, 5]);
    const boxed = boxValue(vm, original, 'Microsoft.UI.Xaml.Thickness');
    const copied = unboxValue(vm, boxed, 'Microsoft.UI.Xaml.Thickness');
    assert.notDeepEqual(copied, original);
    assert.deepEqual(vm.heap.get(copied).data, [2, 3, 4, 5]);
    assert.throws(() => boxValue(vm, otherVM.top.locals[0], 'Point'), /identity/);
  } finally { vm.stop(); otherVM.stop(); }
});
