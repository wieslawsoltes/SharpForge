import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {codedIndex} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

const point = {name: 'Point', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'X', type: 'int'}, {name: 'Tiny', type: 'byte'}], methods: []};
const outer = {name: 'Outer', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'Inner', type: 'valuetype Point'}, {name: 'Tag', type: 'int'}], methods: []};
const holder = {name: 'Holder', fields: [{name: 'Value', type: 'valuetype Point'}], methods: [
  {name: '.ctor', static: false, flags: 0x1886, body: (writer, context) => writer.op('ldarg.0')
    .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')}
]};

test('registered framework values retain their existing heap-backed storage representation', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [{name: 'Main',
    locals: ['Windows.Foundation.Point'], body: writer => writer.op('ret')}]}]);
  const vm = new CilVirtualMachine(bytes);
  try {
    assert.equal(vm.top.locals[0], null);
    const point = vm.heap.allocate('host', 'Windows.Foundation.Point', [2, 3]);
    vm.dereference(vm.address('local', 0), true, point);
    assert.equal(vm.top.locals[0], point);
    vm.heap.methodTables.define({name: 'HostOnlyValue', base: 'System.ValueType', flags: {valueType: true, dynamic: true}});
    const table = vm.heap.methodTables.get('HostOnlyValue');
    const payload = Object.freeze({valueType: table, fields: Object.freeze([])});
    assert.throws(() => vm.storage(payload, table.name), {name: 'NotSupportedException'});
  } finally { vm.stop(); }
});

function fixture(body = writer => writer.op('ret'), {types = [point, outer, holder], decorate, locals} = {}) {
  return genericCallFixture([...types, {name: 'Program', fields: [{name: 'Saved', type: 'valuetype Point', flags: 0x16}],
    methods: [{name: 'Main', locals: locals ?? ['valuetype Point', 'valuetype Point', 'valuetype Outer', 'valuetype Point[]', 'Holder'], body}]
  }], {decorate});
}

test('actual CIL struct copies, initobj, nested fields, statics, object fields and array elements are independent', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), x = context.fields.get('Point.X');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    const saved = context.fields.get('Program.Saved');
    writer.op('ldloca.s', 0).op('initobj', type);
    writer.op('ldloca.s', 0).op('ldflda', x).op('ldc.i4', 11).op('stind.i4');
    writer.op('ldloc.0').op('stloc.1');
    writer.op('ldloca.s', 0).op('ldc.i4', 22).op('stfld', x);
    writer.op('ldloc.1').op('ldfld', x).op('call', print);
    writer.op('ldloc.0').op('ldfld', x).op('call', print);
    writer.op('ldloca.s', 1).op('ldloca.s', 0).op('cpobj', type);
    writer.op('ldloca.s', 0).op('initobj', type);
    writer.op('ldloc.1').op('ldfld', x).op('call', print);
    writer.op('ldloc.0').op('ldfld', x).op('call', print);
    writer.op('ldloca.s', 2).op('ldflda', context.fields.get('Outer.Inner')).op('ldflda', x).op('ldc.i4', 33).op('stind.i4');
    writer.op('ldloc.2').op('ldfld', context.fields.get('Outer.Inner')).op('ldfld', x).op('call', print);
    writer.op('ldloc.1').op('stsfld', saved);
    writer.op('ldsflda', saved).op('ldflda', x).op('ldc.i4', 44).op('stind.i4');
    writer.op('ldsfld', saved).op('ldfld', x).op('call', print);
    writer.op('ldc.i4.2').op('newarr', type).op('stloc.3');
    writer.op('ldloc.3').op('ldc.i4.0').op('ldloc.1').op('stelem', type);
    writer.op('ldloc.3').op('ldc.i4.0').op('ldelema', type).op('ldflda', x).op('ldc.i4', 55).op('stind.i4');
    for (const index of [0, 1]) writer.op('ldloc.3').op('ldc.i4', index).op('ldelem', type).op('ldfld', x).op('call', print);
    writer.op('ldloc.1').op('ldfld', x).op('call', print);
    writer.op('newobj', context.methods.get('Holder..ctor')).op('stloc.s', 4);
    writer.op('ldloc.s', 4).op('ldflda', context.fields.get('Holder.Value')).op('ldflda', x).op('ldc.i4', 66).op('stind.i4');
    writer.op('ldloc.s', 4).op('ldfld', context.fields.get('Holder.Value')).op('ldfld', x).op('call', print).op('ret');
  });
  for (const nativeIntBits of [32, 64]) {
    const vm = new CilVirtualMachine(bytes, {nativeIntBits});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '11\n22\n22\n0\n33\n44\n55\n0\n22\n66\n');
    } finally { vm.stop(); }
  }
});

test('interior addresses follow replacement values, preserve narrow fields and replay immutable snapshots', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const root = vm.address('local', 2);
    const nested = vm.address('field', 0, root), tiny = vm.address('field', 1, nested);
    vm.dereference(tiny, true, 300);
    const first = vm.dereference(root), snapshot = vm.snapshot();
    assert.equal(first.fields[0].fields[1], 44);
    assert(Object.isFrozen(first));
    assert(Object.isFrozen(first.fields));
    vm.dereference(nested, true, vm.storage(vm.top.locals[1], 'Point'));
    vm.dereference(tiny, true, 511);
    assert.equal(vm.dereference(root).fields[0].fields[1], 255);
    assert.equal(first.fields[0].fields[1], 44);
    vm.restore(snapshot);
    assert.equal(vm.dereference(tiny), 44);
    vm.dereference(tiny, true, 7);
    assert.equal(snapshot.frames[0].locals[2].fields[0].fields[1], 44);
    assert.equal(vm.dereference(tiny), 7);
  } finally { vm.stop(); }
});

test('owned value types and interior pointers reject wrong types, foreign VMs, readonly stores and expired frames', () => {
  const vm = new CilVirtualMachine(fixture()), other = new CilVirtualMachine(fixture());
  const pointer = vm.address('field', 0, vm.address('local', 0));
  try {
    assert.throws(() => other.dereference(pointer), /another VM/);
    assert.throws(() => vm.storage(other.top.locals[0], 'Point'), /identity/);
    assert.throws(() => vm.storage(vm.top.locals[0], 'Outer'), /identity/);
    assert.throws(() => vm.storage(vm.top.locals[0], 'object'), /exact value type/);
    assert.throws(() => vm.storage(null, 'Point'), /struct value/);
    assert.throws(() => vm.dereference(Object.freeze({...pointer, readonly: true}), true, 3), /readonly/);
    assert.equal(vm.dereference(pointer), 0);
    vm.run();
    assert.throws(() => vm.dereference(pointer), /outlived/);
  } finally { vm.stop(); other.stop(); }
});

test('ldobj and stobj preserve copies across by-value managed calls', () => {
  const bytes = genericCallFixture([point, {name: 'Program', methods: [
    {name: 'Main', result: 'int', locals: ['valuetype Point', 'valuetype Point'], body(writer, context) {
      const type = context.resolve('Point'), x = context.fields.get('Point.X');
      writer.op('ldloca.s', 0).op('ldc.i4', 9).op('stfld', x);
      writer.op('ldloca.s', 1).op('ldloca.s', 0).op('ldobj', type).op('stobj', type);
      writer.op('ldloc.1').op('call', context.methods.get('Program.Change')).op('pop');
      writer.op('ldloc.0').op('ldfld', x).op('ldloc.1').op('ldfld', x).op('add').op('ret');
    }},
    {name: 'Change', result: 'valuetype Point', parameters: ['valuetype Point'], body(writer, context) {
      writer.op('ldarga.s', 0).op('ldc.i4', 100).op('stfld', context.fields.get('Point.X')).op('ldarg.0').op('ret');
    }}
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().returnValue, 18); }
  finally { vm.stop(); }
});

test('reference-free struct storage rejects a managed handle disguised as an immutable Decimal', () => {
  const vm = new CilVirtualMachine(fixture(undefined, {
    types: [{...point, fields: [{name: 'Amount', type: 'decimal'}]}], locals: ['valuetype Point']
  }));
  try {
    const original = vm.top.locals[0];
    const hybrid = Object.freeze({...original.fields[0], ...vm.heap.string('managed reference')});
    const forged = Object.freeze({valueType: original.valueType, fields: Object.freeze([hybrid])});
    assert.throws(() => vm.dereference(vm.address('local', 0), true, forged), /incompatible value/);
    assert.equal(vm.top.locals[0], original);
  } finally { vm.stop(); }
});

for (const [name, changes, attribute] of [
  ['reference-containing', {fields: [{name: 'Reference', type: 'object'}]}],
  ['auto-layout', {flags: 0x100101}], ['explicit-layout', {flags: 0x100111}],
  ['readonly', {}, 'System.Runtime.CompilerServices.IsReadOnlyAttribute'],
  ['byref-like', {}, 'System.Runtime.CompilerServices.IsByRefLikeAttribute']
]) test(`${name} struct storage remains explicitly unsupported`, () => {
  const bytes = fixture(undefined, {types: [{...point, ...changes}], locals: ['valuetype Point'], decorate(context) {
    if (attribute) context.md.add(12, [codedIndex('HasCustomAttribute', context.types.get('Point')),
      codedIndex('CustomAttributeType', context.member(attribute, '.ctor', 'void', [], false)),
      context.md.blob(Uint8Array.from([1, 0, 0, 0]))]);
  }});
  assert.throws(() => new CilVirtualMachine(bytes), {name: 'NotSupportedException'});
});

test('user struct constructors produce values without allocating a class-shaped value', () => {
  const type = {...point, methods: [{name: '.ctor', parameters: ['int'], static: false, flags: 0x1886,
    body: writer => writer.op('ret')}]};
  const vm = new CilVirtualMachine(fixture((writer, context) => writer.op('ldc.i4.1')
    .op('newobj', context.methods.get('Point..ctor')).op('pop').op('ret'), {types: [type], locals: []}));
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.heap.records.some(record => record?.kind === 'object' && record.methodTable.name === 'Point'), false);
  } finally { vm.stop(); }
});
