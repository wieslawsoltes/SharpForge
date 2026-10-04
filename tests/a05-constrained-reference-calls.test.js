import test from 'node:test';
import assert from 'node:assert/strict';
import {codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function constructor(base = null) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', target).op('ret');
  }};
}

function fixture(main, {interfaceCall = false, explicit = false, trace = false, initLocals = true, expired = false} = {}) {
  const bump = (name, factor, flags) => ({name, static: false, flags, parameters: ['int'], result: 'int', body(writer, context) {
    const field = context.fields.get('Base.X');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('ldc.i4', factor).op('mul').op('add').op('stfld', field);
    if (trace) writer.op('ldc.i4.s', 99).op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
    writer.op('ldarg.0').op('ldfld', field).op('ret');
  }});
  const program = [
    {name: 'Apply', parameters: ['Base&', 'int'], result: 'int', body(writer, context) {
      writer.op('ldarg.0').op('ldarg.1').op('constrained.', context.resolve('Base'));
      writer.op('callvirt', context.methods.get((interfaceCall ? 'IAdjust' : 'Base') + '.Bump')).op('ret');
    }},
    {name: 'Main', result: 'int', initLocals, locals: ['Base', 'Base', 'Base[]', 'Holder', 'object'], body: main}
  ];
  if (expired) program.push({name: 'Expired', result: 'Base&', locals: ['Base'],
    body: writer => writer.op('ldloca.s', 0).op('ret')});
  return genericCallFixture([
    {name: 'IAdjust', interface: true, flags: 0xa1,
      methods: [{name: 'Bump', static: false, flags: 0x5c6, parameters: ['int'], result: 'int'}]},
    {name: 'Base', interfaces: ['IAdjust'], fields: [{name: 'X', type: 'int'}],
      methods: [constructor(), bump('Bump', 1, 0x1c6)]},
    {name: 'Derived', base: 'Base', methods: [constructor('Base'), bump(explicit ? 'Hidden' : 'Bump', 2, explicit ? 0x1e1 : 0xc6)]},
    {name: 'Holder', fields: [{name: 'Value', type: 'Base'}], methods: [constructor()]},
    {name: 'Program', methods: program}
  ], {decorate(context) {
    if (explicit) context.md.add(25, [context.types.get('Derived') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Derived.Hidden')),
      codedIndex('MethodDefOrRef', context.methods.get('IAdjust.Bump'))]);
  }});
}

function withVM(bytes, callback, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

for (const [interfaceCall, explicit] of [[false, false], [true, false], [true, true]]) {
  test(`reference constraint uses existing dynamic slots (interface=${interfaceCall}, explicit=${explicit})`, () => {
    const bytes = fixture((writer, context) => {
      const apply = context.methods.get('Program.Apply');
      writer.op('newobj', context.methods.get('Base..ctor')).op('stloc.0');
      writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.1');
      writer.op('ldloca.s', 0).op('ldc.i4.2').op('call', apply).op('ldc.i4', 100).op('mul');
      writer.op('ldloca.s', 1).op('ldc.i4.3').op('call', apply).op('add').op('ret');
    }, {interfaceCall, explicit});
    for (const inlineCaches of [false, true]) withVM(bytes, vm => {
      const allocations = vm.heap.stats.allocations;
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.returnValue, 206);
      assert.equal(vm.heap.stats.allocations - allocations, 2, 'constrained calls do not allocate replacement receivers');
    }, {inlineCaches});
  });
}

test('array and field reference-slot addresses load the original derived receiver', () => {
  withVM(fixture((writer, context) => {
    const type = context.resolve('Base'), field = context.fields.get('Holder.Value');
    const apply = context.methods.get('Program.Apply');
    writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    writer.op('ldc.i4.1').op('newarr', type).op('stloc.2');
    writer.op('ldloc.2').op('ldc.i4.0').op('ldloc.0').op('stelem.ref');
    writer.op('newobj', context.methods.get('Holder..ctor')).op('stloc.3');
    writer.op('ldloc.3').op('ldloc.0').op('stfld', field);
    writer.op('ldloc.2').op('ldc.i4.0').op('ldelema', type).op('ldc.i4.2').op('call', apply).op('pop');
    writer.op('ldloc.3').op('ldflda', field).op('ldc.i4.3').op('call', apply).op('pop');
    writer.op('ldloc.0').op('ldfld', context.fields.get('Base.X')).op('ret');
  }), vm => {
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 10);
  });
});

test('dereferenced reference remains rooted when a host callback clears the original slot and collects', () => {
  const bytes = fixture((writer, context) => {
    writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    writer.op('ldloca.s', 0).op('ldc.i4.3').op('call', context.methods.get('Program.Apply')).op('ret');
  }, {trace: true});
  let vm, callbacks = 0;
  try {
    vm = new CilVirtualMachine(bytes, {onOutput() {
      callbacks++;
      const reference = vm.top.args[0];
      vm.frames.find(frame => frame.method.name === 'Main').locals[0] = null;
      vm.heap.collect();
      assert.equal(vm.heap.get(reference).type, 'Derived');
    }});
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 6);
    assert.equal(callbacks, 1);
    vm.heap.collect();
    assert.equal(vm.heap.records.some(record => record?.type === 'Derived'), false);
  } finally { vm?.stop(); }
});

function pauseAtCall(vm) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
    return instruction.name === 'callvirt' && frame.method.instructions[frame.pc - 1]?.name === 'constrained.';
  }});
  assert.equal(vm.state, 'paused');
}

test('prefix and active reference-call snapshots replay with the same object identity', () => {
  withVM(fixture((writer, context) => {
    writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    writer.op('ldloca.s', 0).op('ldc.i4.3').op('call', context.methods.get('Program.Apply')).op('ret');
  }), vm => {
    pauseAtCall(vm);
    const prefixSnapshot = vm.snapshot();
    const reference = vm.frames[0].locals[0];
    vm.state = 'running';
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.owner, 'Derived');
    assert.deepEqual(vm.top.args[0], reference);
    const activeSnapshot = vm.snapshot();
    for (const snapshot of [activeSnapshot, prefixSnapshot]) {
      vm.restore(snapshot);
      vm.state = 'running';
      vm.heap.collect();
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 6);
    }
    vm.restore(activeSnapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
  });
});

for (const kind of ['null', 'uninitialized', 'wrong-slot', 'expired']) test(`constrained reference rejects ${kind} storage`, () => {
  withVM(fixture((writer, context) => {
    if (kind === 'expired') writer.op('call', context.methods.get('Program.Expired'));
    else writer.op('ldloca.s', kind === 'wrong-slot' ? 4 : 0);
    writer.op('ldc.i4.1').op('call', context.methods.get('Program.Apply')).op('ret');
  }, {initLocals: kind !== 'uninitialized', expired: kind === 'expired'}), vm => {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, kind === 'null' ? 'NullReferenceException' : 'InvalidProgramException');
  });
});

test('a foreign address and a live incompatible object are rejected after a warm dispatch', () => {
  const bytes = fixture((writer, context) => {
    const apply = context.methods.get('Program.Apply');
    writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    writer.op('ldloca.s', 0).op('ldc.i4.1').op('call', apply).op('pop');
    writer.op('ldloca.s', 0).op('ldc.i4.1').op('call', apply).op('ret');
  });
  withVM(bytes, first => withVM(bytes, second => {
    let sites = 0;
    second.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction(instruction, frame) {
      if (instruction.name !== 'callvirt' || frame.method.instructions[frame.pc - 1]?.name !== 'constrained.') return false;
      return ++sites === 2;
    }});
    assert.equal(second.state, 'paused');
    const snapshot = second.snapshot();
    second.top.stack[0] = first.address('local', 0);
    second.state = 'running';
    assert.equal(second.run().fault?.name, 'InvalidProgramException');
    second.restore(snapshot);
    second.frames[0].locals[0] = second.heap.object(second.typeSystem.table('Holder'), [null]);
    second.state = 'running';
    assert.equal(second.run().fault?.name, 'InvalidProgramException');
  }));
});

test('external Object members remain rejected for reference constraints', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0).op('constrained.', context.resolve('Base'));
    writer.op('callvirt', context.member('System.Object', 'GetHashCode', 'int', [], false)).op('ret');
  });
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX' && issue.message.includes('internal class')));
});

test('reference constraints do not admit default-interface bodies', () => {
  const bytes = genericCallFixture([
    {name: 'IValue', interface: true, flags: 0xa1,
      methods: [{name: 'Get', static: false, flags: 0x1c6, result: 'int', body: writer => writer.op('ldc.i4.1').op('ret')}]},
    {name: 'Instance', interfaces: ['IValue'], methods: [constructor()]},
    {name: 'Program', methods: [{name: 'Main', locals: ['Instance'], result: 'int', body(writer, context) {
      writer.op('newobj', context.methods.get('Instance..ctor')).op('stloc.0');
      writer.op('ldloca.s', 0).op('constrained.', context.resolve('Instance'));
      writer.op('callvirt', context.methods.get('IValue.Get')).op('ret');
    }}]}
  ]);
  withVM(bytes, vm => assert.equal(vm.run().fault?.name, 'NotSupportedException'));
});

for (const definitionToken of [false, true]) test(`generic reference constraint is rejected (TypeDef=${definitionToken})`, () => {
  const bytes = genericCallFixture([
    {name: 'Box`1', genericParameters: [{}], methods: [{name: 'Get', static: false, flags: 0x1c6,
      result: 'int', body: writer => writer.op('ldc.i4.1').op('ret')}]},
    {name: 'Program', methods: [{name: 'Main', locals: ['Box`1<int>'], result: 'int', body(writer, context) {
      const closed = context.typeSpec('Box`1<int>');
      const member = context.member(closed, 'Get', 'int', [], false);
      writer.op('ldloca.s', 0).op('constrained.', definitionToken ? context.resolve('Box`1') : closed);
      writer.op('callvirt', member).op('ret');
    }}]}
  ]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX' && issue.message.includes('nongeneric')));
});
