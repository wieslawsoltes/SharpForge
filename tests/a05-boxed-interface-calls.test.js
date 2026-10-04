import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture(main, {explicit = false, defaultBody = false, throwing = false} = {}) {
  const name = explicit ? 'Hidden' : 'Bump';
  return genericCallFixture([
    {name: 'IAdjust', interface: true, flags: 0xa1, methods: [{name: 'Bump', static: false,
      flags: defaultBody ? 0x1c6 : 0x5c6, parameters: ['int'], result: 'int',
      ...(defaultBody ? {body: writer => writer.op('ldc.i4.s', 99).op('ret')} : {})}]},
    {name: 'Point', base: 'System.ValueType', flags: 0x100109, interfaces: ['IAdjust'],
      fields: [{name: 'X', type: 'int'}], methods: defaultBody ? [] : [{name, static: false,
        flags: explicit ? 0x1e1 : 0x1e6, parameters: ['int'], result: 'int', body(writer, context) {
          if (throwing) { writer.op('ldnull').op('throw'); return; }
          const field = context.fields.get('Point.X');
          writer.op('call', context.member('System.GC', 'Collect', 'void'));
          writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('add').op('stfld', field);
          writer.op('ldarg.0').op('ldfld', field).op('ret');
        }}]},
    {name: 'Other', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Program', methods: [
      {name: 'Apply', parameters: ['IAdjust', 'int'], result: 'int', body(writer, context) {
        writer.op('ldarg.0').op('ldarg.1').op('callvirt', context.methods.get('IAdjust.Bump')).op('ret');
      }},
      {name: 'Main', result: 'void', locals: ['valuetype Point', 'IAdjust', 'IAdjust', 'valuetype Other'], body: main}
    ]}
  ], {decorate(context) {
    if (explicit) context.md.add(25, [context.types.get('Point') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Point.Hidden')),
      codedIndex('MethodDefOrRef', context.methods.get('IAdjust.Bump'))]);
  }});
}

function run(bytes, assertion, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { assertion(vm.run(), vm); }
  finally { vm.stop(); }
}

for (const explicit of [false, true]) test(`boxed struct ${explicit ? 'explicit' : 'implicit'} interface calls mutate only their box`, () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), field = context.fields.get('Point.X');
    const apply = context.methods.get('Program.Apply');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldloca.s', 0).op('ldc.i4.s', 10).op('stfld', field);
    writer.op('ldloc.0').op('box', type).op('stloc.1');
    writer.op('ldloc.0').op('box', type).op('stloc.2');
    for (const [local, delta] of [[1, 2], [1, 3], [2, 1]]) {
      writer.op('ldloc.s', local).op('ldc.i4', delta).op('call', apply).op('call', print);
    }
    writer.op('ldloc.0').op('ldfld', field).op('call', print);
    for (const local of [1, 2]) writer.op('ldloc.s', local).op('unbox.any', type).op('ldfld', field).op('call', print);
    writer.op('ldloc.1').op('callvirt', context.member('System.Object', 'GetType', 'System.Type', [], false));
    writer.op('callvirt', context.member('System.Type', 'get_Name', 'string', [], false));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret');
  }, {explicit});
  for (const inlineCaches of [false, true]) run(bytes, (result, vm) => {
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '12\n15\n11\n10\n15\n11\nPoint\n');
    assert(vm.heap.stats.collections >= 3);
  }, {inlineCaches});
});

test('an active boxed implementation retains its interior across GC, snapshot replay and stop', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloc.0').op('box', context.resolve('Point')).op('stloc.1');
    writer.op('ldloc.1').op('ldc.i4.7').op('callvirt', context.methods.get('IAdjust.Bump'));
    writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
  });
  const vm = new CilVirtualMachine(bytes);
  try {
    vm.runSlice({instructionBudget: 6, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.owner, 'Point');
    const address = vm.top.args[0], snapshot = vm.snapshot();
    assert.equal(address.kind, 'box');
    vm.heap.collect();
    assert.equal(vm.heap.get(address.owner).methodTable.name, 'Point');
    assert.equal(vm.run().output, '7\n');
    vm.restore(snapshot);
    assert.equal(vm.run().output, '7\n');
    vm.restore(snapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.dereference(address), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

for (const wrong of ['null', 'other']) test(`interface call rejects ${wrong} after a successful call at the same site`, () => {
  run(fixture((writer, context) => {
    const apply = context.methods.get('Program.Apply');
    writer.op('ldloc.0').op('box', context.resolve('Point')).op('ldc.i4.1').op('call', apply).op('pop');
    if (wrong === 'null') writer.op('ldnull');
    else writer.op('ldloc.3').op('box', context.resolve('Other'));
    writer.op('ldc.i4.1').op('call', apply).op('pop').op('ret');
  }), result => {
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, wrong === 'null' ? 'NullReferenceException' : 'InvalidProgramException');
  });
});

test('boxed struct default-interface bodies remain explicitly unsupported', () => {
  run(fixture((writer, context) => writer.op('ldloc.0').op('box', context.resolve('Point')).op('ldc.i4.1')
    .op('callvirt', context.methods.get('IAdjust.Bump')).op('pop').op('ret'), {defaultBody: true}), result => {
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'NotSupportedException');
  });
});

test('boxed struct generic interface dispatch remains explicitly unsupported', () => {
  const bytes = genericCallFixture([
    {name: 'I`1', interface: true, flags: 0xa1, genericParameters: [{}],
      methods: [{name: 'Get', static: false, flags: 0x5c6, result: 'int'}]},
    {name: 'Point', base: 'System.ValueType', flags: 0x100109, interfaces: ['I`1<int>'],
      fields: [{name: 'X', type: 'int'}], methods: [{name: 'Get', static: false, flags: 0x1e6, result: 'int',
        body: writer => writer.op('ldc.i4.1').op('ret')}]},
    {name: 'Program', methods: [{name: 'Main', locals: ['valuetype Point'], body(writer, context) {
      const method = context.member(context.typeSpec('I`1<int>'), 'Get', 'int', [], false);
      writer.op('ldloc.0').op('box', context.resolve('Point')).op('callvirt', method).op('pop').op('ret');
    }}]}
  ]);
  run(bytes, result => assert.equal(result.fault?.name, 'NotSupportedException'));
});

test('throwing boxed implementations release their frame-owned interior', () => {
  run(fixture((writer, context) => writer.op('ldloc.0').op('box', context.resolve('Point')).op('ldc.i4.1')
    .op('callvirt', context.methods.get('IAdjust.Bump')).op('pop').op('ret'), {throwing: true}), (result, vm) => {
    assert.equal(result.fault?.name, 'NullReferenceException');
    assert.equal(vm.frames.length, 0);
    vm.heap.collect();
    assert.equal(vm.heap.records.some(record => record?.kind === 'box' && record.type === 'Point'), false);
  });
});
