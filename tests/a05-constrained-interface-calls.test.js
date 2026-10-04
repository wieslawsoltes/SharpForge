import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, codedIndex, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture(main, {explicit = false, initialize = false, defaultBody = false, throwing = false} = {}) {
  const name = explicit ? 'Hidden' : 'Bump';
  const methods = defaultBody ? [] : [{name, static: false, flags: explicit ? 0x1e1 : 0x1e6,
    parameters: ['int'], result: 'int', body(writer, context) {
      if (throwing) { writer.op('ldnull').op('throw'); return; }
      const field = context.fields.get('Point.X');
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('add').op('stfld', field);
      writer.op('ldarg.0').op('ldfld', field).op('ret');
    }}];
  if (initialize) methods.push({name: '.cctor', body(writer, context) {
    const counter = context.fields.get('Point.Initializations');
    writer.op('ldsfld', counter).op('ldc.i4.1').op('add').op('stsfld', counter).op('ret');
  }});
  return genericCallFixture([
    {name: 'IAdjust', interface: true, flags: 0xa1, methods: [{name: 'Bump', static: false,
      flags: defaultBody ? 0x1c6 : 0x5c6, parameters: ['int'], result: 'int',
      ...(defaultBody ? {body: writer => writer.op('ldc.i4.s', 99).op('ret')} : {})}]},
    {name: 'Point', base: 'System.ValueType', flags: initialize ? 0x109 : 0x100109, interfaces: ['IAdjust'],
      fields: [{name: 'X', type: 'int'}, {name: 'Initializations', type: 'int', flags: 0x16}], methods},
    {name: 'Other', base: 'System.ValueType', flags: 0x100109, fields: [{name: 'X', type: 'int'}], methods: []},
    {name: 'Holder', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Point', type: 'valuetype Point'}], methods: []},
    {name: 'Program', methods: [{name: 'Main', result: 'int',
      locals: ['valuetype Point', 'valuetype Point', 'valuetype Point[]', 'valuetype Holder', 'object', 'valuetype Other'],
      body: main}]}
  ], {decorate(context) {
    if (explicit) context.md.add(25, [context.types.get('Point') & 0xffffff,
      codedIndex('MethodDefOrRef', context.methods.get('Point.Hidden')),
      codedIndex('MethodDefOrRef', context.methods.get('IAdjust.Bump'))]);
  }});
}

function constrained(writer, context, delta = 5) {
  writer.op('ldc.i4', delta).op('constrained.', context.resolve('Point'))
    .op('callvirt', context.methods.get('IAdjust.Bump'));
}

function withVM(bytes, callback, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

for (const explicit of [false, true]) test(`constrained ${explicit ? 'explicit' : 'implicit'} interface dispatch mutates storage without boxing`, () => {
  const bytes = fixture((writer, context) => {
    const field = context.fields.get('Point.X');
    writer.op('ldloca.s', 0).op('ldc.i4.s', 10).op('stfld', field);
    writer.op('ldloc.0').op('stloc.1').op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('pop').op('ldloc.0').op('ldfld', field).op('ldc.i4', 100).op('mul');
    writer.op('ldloc.1').op('ldfld', field).op('add').op('ret');
  }, {explicit});
  for (const decodePlans of [false, true]) withVM(bytes, vm => {
    const allocations = vm.heap.stats.allocations;
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.returnValue, 1510);
    assert.equal(vm.heap.stats.allocations, allocations);
    assert(vm.heap.stats.collections > 0);
  }, {decodePlans});
});

test('constrained array, nested field and existing box interiors preserve the owning storage through GC', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Point'), field = context.fields.get('Point.X');
    writer.op('ldc.i4.1').op('newarr', type).op('stloc.2');
    writer.op('ldloc.2').op('ldc.i4.0').op('ldelema', type);
    constrained(writer, context, 7);
    writer.op('pop').op('ldloca.s', 3).op('ldflda', context.fields.get('Holder.Point'));
    constrained(writer, context, 9);
    writer.op('pop').op('ldloc.0').op('box', type).op('stloc.s', 4);
    writer.op('ldloc.s', 4).op('unbox', type);
    constrained(writer, context, 11);
    writer.op('pop').op('ldloc.2').op('ldc.i4.0').op('ldelem', type).op('ldfld', field);
    writer.op('ldloc.3').op('ldfld', context.fields.get('Holder.Point')).op('ldfld', field).op('add');
    writer.op('ldloc.s', 4).op('unbox.any', type).op('ldfld', field).op('add').op('ret');
  });
  withVM(bytes, vm => {
    const allocations = vm.heap.stats.allocations;
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 27);
    assert.equal(vm.heap.stats.allocations - allocations, 2, 'only the explicit array and box are allocated');
  });
});

for (const budget of [3, 4]) test(`snapshot at instruction ${budget} preserves constrained prefix/callee and owned receiver`, () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('ret');
  });
  withVM(bytes, vm => {
    vm.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.owner, budget === 3 ? 'Program' : 'Point');
    const address = budget === 3 ? vm.top.stack[0] : vm.top.args[0];
    const snapshot = vm.snapshot();
    vm.heap.collect();
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 5);
    vm.restore(snapshot);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 5);
    vm.restore(snapshot);
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  });
});

test('static initialization retry retains the constrained call and its unconsumed operands across snapshot restore', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('pop').op('ldloca.s', 0);
    constrained(writer, context, 2);
    writer.op('ldsfld', context.fields.get('Point.Initializations')).op('ldc.i4', 100).op('mul').op('add').op('ret');
  }, {initialize: true});
  withVM(bytes, vm => {
    vm.runSlice({instructionBudget: 4, timeBudgetMs: Infinity});
    assert.equal(vm.top.method.name, '.cctor');
    assert.equal(vm.frames[0].stack.length, 2);
    const snapshot = vm.snapshot();
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 107);
    vm.restore(snapshot);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 107);
  });
});

for (const receiver of ['null', 'copy', 'wrong']) test(`constrained dispatch rejects a ${receiver} receiver`, () => {
  const bytes = fixture((writer, context) => {
    if (receiver === 'null') writer.op('ldnull');
    else if (receiver === 'copy') writer.op('ldloc.0');
    else writer.op('ldloca.s', 5);
    constrained(writer, context);
    writer.op('ret');
  });
  withVM(bytes, vm => {
    assert.equal(vm.run().fault?.name, 'InvalidProgramException');
  });
});

test('foreign and readonly addresses cannot enter a constrained implementation', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('ret');
  });
  withVM(bytes, first => withVM(bytes, second => {
    const foreign = first.address('local', 0);
    second.runSlice({instructionBudget: 3, timeBudgetMs: Infinity});
    const snapshot = second.snapshot(), own = second.top.stack[0];
    second.top.stack[0] = foreign;
    assert.equal(second.run().fault?.name, 'InvalidProgramException');
    second.restore(snapshot);
    second.top.stack[0] = Object.freeze({...own, readonly: true});
    assert.equal(second.run().fault?.name, 'NotSupportedException');
  }));
});

test('default-interface implementation remains an explicit unsupported boundary', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('ret');
  }, {defaultBody: true});
  withVM(bytes, vm => assert.equal(vm.run().fault?.name, 'NotSupportedException'));
});

test('throwing constrained implementation releases frames without allocating a receiver box', () => {
  const bytes = fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('ret');
  }, {throwing: true});
  withVM(bytes, vm => {
    assert.equal(vm.run().fault?.name, 'NullReferenceException');
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.heap.records.some(record => record?.kind === 'box'), false);
  });
});

for (const malformed of ['dangling', 'wrong-opcode', 'duplicate', 'branch-tail', 'switch-tail',
  'class', 'object-call', 'type-spec', 'primitive']) {
  test(`verifier rejects constrained ${malformed}`, () => {
    const bytes = fixture((writer, context) => {
      const type = malformed === 'type-spec' ? context.typeSpec('valuetype Point')
        : context.resolve(malformed === 'class' ? 'Program' : malformed === 'primitive' ? 'System.Int32' : 'Point');
      if (malformed === 'dangling') { writer.op('constrained.', type); return; }
      writer.op('ldloca.s', 0).op('ldc.i4.1');
      if (malformed === 'branch-tail') writer.op('br', 'call');
      if (malformed === 'switch-tail') writer.op('ldc.i4.0').op('switch', ['call']);
      writer.op('constrained.', type);
      if (malformed === 'wrong-opcode') writer.op('nop');
      if (malformed === 'duplicate') writer.op('constrained.', type);
      const method = malformed === 'object-call'
        ? context.member('System.Object', 'Equals', 'bool', ['object'], false) : context.methods.get('IAdjust.Bump');
      writer.mark('call').op('callvirt', method).op('ret');
    });
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_PREFIX'), JSON.stringify(report.issues));
  });
}

test('a generic interface declaration stays unsupported even with a nongeneric struct receiver', () => {
  const bytes = genericCallFixture([
    {name: 'I`1', interface: true, flags: 0xa1, genericParameters: [{}],
      methods: [{name: 'Get', static: false, flags: 0x5c6, result: 'int'}]},
    {name: 'Point', base: 'System.ValueType', flags: 0x100109, interfaces: ['I`1<int>'],
      fields: [{name: 'X', type: 'int'}], methods: [{name: 'Get', static: false, flags: 0x1e6, result: 'int',
        body: writer => writer.op('ldc.i4.1').op('ret')}]},
    {name: 'Program', methods: [{name: 'Main', locals: ['valuetype Point'], result: 'int', body(writer, context) {
      const method = context.member(context.typeSpec('I`1<int>'), 'Get', 'int', [], false);
      writer.op('ldloca.s', 0).op('constrained.', context.resolve('Point')).op('callvirt', method).op('ret');
    }}]}
  ]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX' && issue.message.includes('nongeneric interface')));
});

test('exception boundaries cannot split a constrained prefix from its call', () => {
  const inspector = new AssemblyInspector(fixture((writer, context) => {
    writer.op('ldloca.s', 0);
    constrained(writer, context);
    writer.op('ret');
  }));
  const method = inspector.getMethod(inspector.pe.entryPoint);
  const call = method.instructions.find(instruction => instruction.name === 'callvirt');
  const ret = method.instructions.at(-1);
  method.handlers.push({flags: 0, start: 0, end: call.offset, target: call.offset,
    handlerEnd: ret.offset, catchType: 0});
  const report = verifyCilAssembly(inspector);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_PREFIX' && issue.message.includes('exception region')));
});
