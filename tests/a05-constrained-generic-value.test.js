import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, isByrefStructForwarder, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture({explicit = false, initialize = false, main, malformed, constraint = 'IAdjust'} = {}) {
  const implementation = (owner, multiplier) => ({name: explicit ? 'Hidden' : 'Bump', static: false,
    flags: explicit ? 0x1e1 : 0x1e6, parameters: ['int'], result: 'int', body(writer, context) {
      const field = context.fields.get(owner + '.X');
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('ldc.i4', multiplier).op('mul').op('add').op('stfld', field);
      writer.op('ldarg.0').op('ldfld', field).op('ret');
    }});
  const pointMethods = [implementation('Point', 1)];
  if (initialize) pointMethods.push({name: '.cctor', body(writer, context) {
    const field = context.fields.get('Point.Initializations');
    writer.op('ldsfld', field).op('ldc.i4.1').op('add').op('stsfld', field).op('ret');
  }});
  const call = (context, argument = 'Point') => context.methodSpec(context.methods.get('Helper.Apply'), ['valuetype ' + argument]);
  return genericCallFixture([
    {name: 'IAdjust', interface: true, flags: 0xa1,
      methods: [{name: 'Bump', static: false, flags: 0x5c6, parameters: ['int'], result: 'int'}]},
    {name: 'Point', base: 'System.ValueType', flags: initialize ? 0x109 : 0x100109, interfaces: ['IAdjust'],
      fields: [{name: 'X', type: 'int'}, {name: 'Initializations', type: 'int', flags: 0x16}], methods: pointMethods},
    {name: 'Other', base: 'System.ValueType', flags: 0x100109, interfaces: ['IAdjust'],
      fields: [{name: 'X', type: 'int'}], methods: [implementation('Other', 2)]},
    {name: 'Holder', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Point', type: 'valuetype Point'}], methods: []},
    {name: 'Managed', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'Ref', type: 'object'}], methods: []},
    {name: 'Auto', base: 'System.ValueType', flags: 0x100101, fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Explicit', base: 'System.ValueType', flags: 0x100111, fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Generic`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
      fields: [{name: 'X', type: '!0'}], methods: []},
    {name: 'Helper', methods: [{name: 'Apply', genericParameters: [{flags: 24}],
      parameters: [malformed === 'by-value' ? '!!0' : '!!0&',
        malformed === 'nested-signature' ? 'System.Collections.Generic.List`1<!!0>' : 'int'],
      result: malformed === 'generic-return' ? '!!0' : 'int',
      locals: malformed === 'local' ? ['!!0'] : malformed === 'nested-local' ? ['System.Collections.Generic.List`1<!!0>'] : [],
      body(writer, context) {
        const variable = context.typeSpec('!!0');
        writer.op('nop');
        if (malformed === 'load-value') writer.op('ldarg.0').op('ldobj', variable).op('pop');
        if (malformed === 'box-value') writer.op('ldarg.0').op('ldobj', variable).op('box', variable).op('pop');
        if (malformed === 'recursive-forward') {
          writer.op('ldarg.0').op('ldarg.1').op('call', context.methodSpec(context.methods.get('Helper.Apply'), ['!!0'])).op('pop');
        }
        writer.op('ldarg.0').op('nop').op('ldarg.1').op('constrained.', variable);
        if (malformed === 'prefix-nop') writer.op('nop');
        writer.op('callvirt', context.methods.get('IAdjust.Bump')).op('nop').op('ret');
        if (malformed === 'unreachable-storage') writer.op('ldarg.0').op('ldobj', variable).op('pop').op('ldc.i4.0').op('ret');
      }}]},
    {name: 'Program', methods: [{name: 'Main', result: 'int',
      locals: ['valuetype Point', 'valuetype Point', 'valuetype Other', 'valuetype Holder', 'valuetype Point[]', 'object'],
      body(writer, context) {
        if (main) { main(writer, context, argument => call(context, argument)); return; }
        const field = context.fields.get('Point.X');
        writer.op('ldloca.s', 0).op('ldc.i4.s', 10).op('stfld', field).op('ldloc.0').op('stloc.1');
        writer.op('ldloca.s', 0).op('ldc.i4.5').op('call', call(context)).op('ldc.i4', 100).op('mul');
        writer.op('ldloca.s', 2).op('ldc.i4.7').op('call', call(context, 'Other')).op('ldc.i4.s', 10).op('mul').op('add');
        writer.op('ldloc.1').op('ldfld', field).op('add').op('ret');
      }}]
    }
  ], {decorate(context) {
    const owner = codedIndex('TypeOrMethodDef', context.methods.get('Helper.Apply'));
    const parameter = context.md.rows[42].findIndex(row => row[2] === owner);
    context.md.add(44, [parameter + 1, codedIndex('TypeDefOrRef', context.resolve(constraint))]);
    if (explicit) for (const name of ['Point', 'Other']) context.md.add(25, [context.types.get(name) & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get(name + '.Hidden')),
      codedIndex('MethodDefOrRef', context.methods.get('IAdjust.Bump'))]);
  }});
}

function withVM(bytes, callback, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pauseBefore(vm, predicate) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction: predicate});
  assert.equal(vm.state, 'paused');
}

for (const explicit of [false, true]) test(`generic struct forwarder preserves ${explicit ? 'explicit' : 'implicit'} dispatch and copies`, () => {
  const bytes = fixture({explicit});
  for (const decodePlans of [false, true]) withVM(bytes, vm => {
    const allocations = vm.heap.stats.allocations;
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.returnValue, 1650);
    assert.equal(vm.heap.stats.allocations, allocations, 'generic forwarding does not allocate boxes');
    assert(vm.heap.stats.collections > 0);
  }, {decodePlans});
});

test('generic forwarding preserves array, nested-value and existing box interiors', () => {
  withVM(fixture({main(writer, context, call) {
    const point = context.resolve('Point');
    writer.op('ldc.i4.1').op('newarr', point).op('stloc.s', 4);
    writer.op('ldloc.s', 4).op('ldc.i4.0').op('ldelema', point).op('ldc.i4.7').op('call', call());
    writer.op('ldloca.s', 3).op('ldflda', context.fields.get('Holder.Point')).op('ldc.i4.s', 9).op('call', call()).op('add');
    writer.op('ldloc.0').op('box', point).op('stloc.s', 5);
    writer.op('ldloc.s', 5).op('unbox', point).op('ldc.i4.s', 11).op('call', call()).op('add').op('ret');
  }}), vm => {
    const allocations = vm.heap.stats.allocations;
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 27);
    assert.equal(vm.heap.stats.allocations - allocations, 2, 'only the explicit array and box allocate');
  });
});

for (const active of [false, true]) test(`snapshot of ${active ? 'implementation' : 'generic prefix'} retains owned struct storage`, () => {
  withVM(fixture(), vm => {
    pauseBefore(vm, (instruction, frame) => active ? frame.method.owner === 'Point' : instruction.name === 'callvirt');
    const address = active ? vm.top.args[0] : vm.top.stack[0];
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.state = 'running';
      vm.heap.collect();
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 1650);
    }
    vm.restore(snapshot);
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  });
});

test('generic struct initialization retries keep the exact prefix and argument values', () => {
  withVM(fixture({initialize: true, main(writer, context, call) {
    writer.op('ldloca.s', 0).op('ldc.i4.5').op('call', call()).op('pop');
    writer.op('ldloca.s', 0).op('ldc.i4.2').op('call', call());
    writer.op('ldsfld', context.fields.get('Point.Initializations')).op('ldc.i4', 100).op('mul').op('add').op('ret');
  }}), vm => {
    pauseBefore(vm, (_instruction, frame) => frame.method.name === '.cctor');
    const helper = vm.frames.find(frame => frame.method.name === 'Apply');
    assert.equal(helper.stack.length, 2);
    assert.equal(helper.method.instructions[helper.pc].name, 'callvirt');
    const snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 107);
    }
  });
});

for (const receiver of ['wrong', 'foreign', 'readonly', 'uninitialized']) test(`generic struct receiver rejects ${receiver} addresses`, () => {
  const bytes = fixture();
  withVM(bytes, vm => withVM(bytes, other => {
    const wrong = vm.address('local', 2), foreign = other.address('local', 0);
    pauseBefore(vm, instruction => instruction.name === 'callvirt');
    if (receiver === 'wrong') vm.top.stack[0] = wrong;
    if (receiver === 'foreign') vm.top.stack[0] = foreign;
    if (receiver === 'readonly') vm.top.stack[0] = Object.freeze({...vm.top.stack[0], readonly: true});
    if (receiver === 'uninitialized') vm.frames[0].locals[0] = undefined;
    vm.state = 'running';
    assert.equal(vm.run().fault?.name, receiver === 'readonly' ? 'NotSupportedException' : 'InvalidProgramException');
  }));
});

test('struct forwarding preserves metadata interface constraints before execution', () => {
  withVM(fixture({constraint: 'Other'}), vm => assert.equal(vm.run().fault?.name, 'ArgumentException'));
});

for (const argument of ['Managed', 'Auto', 'Explicit']) test(`generic admission rejects unsupported ${argument} struct storage`, () => {
  withVM(fixture({main(writer, _context, call) {
    writer.op('ldnull').op('ldc.i4.1').op('call', call(argument)).op('ret');
  }}), vm => assert.equal(vm.run().fault?.name, 'NotSupportedException'));
});

test('generic struct layout is not enabled by nongeneric struct admission', () => {
  const report = verifyCilAssembly(fixture({main(writer, _context, call) {
    writer.op('ldnull').op('ldc.i4.1').op('call', call('Generic`1<int>')).op('ret');
  }}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.message.includes('static Apply<T>')));
});

for (const malformed of ['by-value', 'local', 'nested-local', 'nested-signature', 'generic-return',
  'load-value', 'box-value', 'recursive-forward', 'prefix-nop', 'unreachable-storage']) {
  test(`byref-only admission rejects ${malformed} aggregate use in the canonical body`, () => {
    const bytes = fixture({malformed}), inspector = new AssemblyInspector(bytes);
    const method = [...inspector.methods.values()].find(method => method.name === 'Apply');
    assert.equal(isByrefStructForwarder(inspector, method.token), false);
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.message.includes('static Apply<T>')));
  });
}
