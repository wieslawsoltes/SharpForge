import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, encodeSignature, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const scalar = name => ({kind: 'primitive', name});
const signature = (options = {}) => ({kind: 'method', hasThis: true,
  returnType: scalar('int'), parameters: [scalar('int')], ...options});
const standalone = (context, options) => context.md.add(17, [context.md.blob(encodeSignature(signature(options)))]);

function constructor(base) {
  return {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
    const target = base ? context.methods.get(base + '..ctor') : context.member('System.Object', '.ctor', 'void', [], false);
    writer.op('ldarg.0').op('call', target).op('ret');
  }};
}

function fixture({local = false, join = false, target = 'Base.Bump', trace = false, initialize = false,
  callSignature, main, prefix, ownerType, instanceSignature, maxStack = 16} = {}) {
  const bump = (name, bonus, flags) => ({name, static: false, flags, maxStack, result: 'int', parameters: ['int'],
    ...(instanceSignature ? {signature: encodeSignature(signature(instanceSignature))} : {}), body(writer, context) {
      writer.op('call', context.member('System.GC', 'Collect', 'void'));
      const field = context.fields.get('Base.X');
      writer.op('ldarg.0').op('dup').op('ldfld', field).op('ldarg.1').op('add');
      if (initialize) writer.op('ldsfld', context.fields.get('Base.Bonus'));
      else writer.op('ldc.i4', bonus);
      writer.op('add').op('stfld', field);
      if (trace) writer.op('ldarg.0').op('ldfld', field).op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
      writer.op('ldarg.0').op('ldfld', field).op('ret');
    }});
  return genericCallFixture([
    {name: 'Base', fields: [{name: 'X', type: 'int'}, {name: 'Bonus', type: 'int', flags: 0x16}],
      methods: [constructor(), bump('Bump', 1, 0x1c6), bump('Alternate', 2, 0x86),
        ...(initialize ? [{name: '.cctor', flags: 0x1891, body(writer, context) {
          writer.op('ldc.i4.7').op('stsfld', context.fields.get('Base.Bonus')).op('ret');
        }}] : [])]},
    {name: 'Derived', base: 'Base', methods: [constructor('Base'), bump('Bump', 100, 0xc6)]},
    {name: 'Other', methods: [constructor()]},
    ...(ownerType ? [ownerType] : []),
    {name: 'Program', methods: [
      {name: 'Static', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ret')},
      {name: 'Main', result: 'int', maxStack, locals: ['Base', 'nint', 'Other', 'nint'], body(writer, context) {
        if (main) { main(writer, context); return; }
        writer.op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
        writer.op('ldftn', context.methods.get('Program.Static')).op('stloc.3');
        if (local) {
          if (join) writer.op('ldc.i4.0').op('brfalse.s', 'other');
          writer.op('ldftn', context.methods.get(target)).op('stloc.1');
          if (join) writer.op('br.s', 'invoke').mark('other')
            .op('ldftn', context.methods.get('Base.Alternate')).op('stloc.1').mark('invoke');
        }
        writer.op('ldloc.0').op('ldc.i4', 41);
        if (local) writer.op('ldloc.1');
        else writer.op('ldftn', context.methods.get(target));
        if (prefix) writer.op(prefix);
        writer.op('calli', standalone(context, callSignature)).op('ret');
      }}
    ]}
  ]);
}

function withVM(bytes, callback, options = {}) {
  const vm = new CilVirtualMachine(bytes, options);
  try { callback(vm); } finally { vm.stop(); }
}

function pause(vm, predicate = instruction => instruction.name === 'calli') {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity, onInstruction: predicate});
  assert.equal(vm.state, 'paused');
}

for (const local of [false, true]) for (const nativeIntBits of [32, 64]) {
  test(`instance calli with ${local ? 'native local' : 'stack'} pointer at ABI${nativeIntBits} calls the selected base body`, () => {
    withVM(fixture({local}), vm => {
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, 42, 'Derived.Bump would return 141; ldftn must not redispatch');
      assert.equal(vm.heap.records.find(record => record?.type === 'Derived').data[0], 42);
    }, {nativeIntBits});
  });
}

test('compatible instance targets retain signature proof through native-local control-flow joins', () => {
  withVM(fixture({local: true, join: true}), vm => assert.equal(vm.run().returnValue, 43));
});

test('zero declared arguments and void result still consume exactly one receiver', () => {
  const bytes = genericCallFixture([
    {name: 'Counter', fields: [{name: 'X', type: 'int'}], methods: [constructor(),
      {name: 'Set', static: false, body(writer, context) {
        writer.op('ldarg.0').op('ldc.i4.7').op('stfld', context.fields.get('Counter.X')).op('ret');
      }}]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['Counter'], body(writer, context) {
      writer.op('newobj', context.methods.get('Counter..ctor')).op('stloc.0');
      writer.op('ldloc.0').op('ldftn', context.methods.get('Counter.Set'));
      writer.op('calli', standalone(context, {parameters: [], returnType: scalar('void')}));
      writer.op('ldloc.0').op('ldfld', context.fields.get('Counter.X')).op('ret');
    }}]}
  ]);
  withVM(bytes, vm => assert.equal(vm.run().returnValue, 7));
});

for (const active of [false, true]) test(`snapshot at ${active ? 'callee' : 'indirect call'} preserves pointer and receiver ownership`, () => {
  withVM(fixture({local: true}), vm => {
    pause(vm, active ? (instruction, frame) => frame.method.name === 'Bump' : undefined);
    const receiver = vm.frames[0].locals[0], pointer = vm.frames[0].locals[1], snapshot = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      invalidateExecutionCode(vm, 'instance-calli-replay');
      assert.equal(vm.frames[0].locals[0], receiver);
      assert.equal(vm.frames[0].locals[1], pointer);
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 42);
    }
    vm.restore(snapshot);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
  });
});

test('null, wrong, foreign, copied and stale receivers fail before any operand is removed', () => {
  const bytes = fixture();
  withVM(bytes, vm => withVM(bytes, foreign => {
    pause(vm); pause(foreign);
    const original = vm.top.stack[0], snapshot = vm.snapshot();
    assert.deepEqual(original, foreign.top.stack[0], 'foreign h/g can collide with valid local coordinates');
    const cases = [
      [null, 'NullReferenceException'], [undefined, 'InvalidProgramException'], [123, 'InvalidProgramException'],
      [foreign.top.stack[0], 'InvalidProgramException'], [Object.freeze({...original}), 'InvalidProgramException']
    ];
    for (const [receiver, name] of cases) {
      vm.restore(snapshot);
      vm.top.stack[0] = receiver;
      const operands = [...vm.top.stack];
      assert.throws(() => vm.step(), {name});
      assert.deepEqual(vm.top.stack, operands);
    }
    vm.restore(snapshot);
    const wrong = vm.heap.object(vm.typeSystem.table('Other'), []);
    vm.top.stack[0] = wrong;
    let operands = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
    assert.deepEqual(vm.top.stack, operands);
    vm.restore(snapshot);
    const stale = vm.heap.object(vm.typeSystem.table('Base'), [0]);
    vm.heap.collect();
    vm.top.stack[0] = stale;
    operands = [...vm.top.stack];
    assert.throws(() => vm.step(), {name: 'InvalidReferenceException'});
    assert.deepEqual(vm.top.stack, operands);
  }));
});

test('foreign, copied and mismatched pointers fail before consuming the explicit receiver', () => {
  const bytes = fixture();
  withVM(bytes, vm => withVM(bytes, foreign => {
    pause(vm); pause(foreign);
    const snapshot = vm.snapshot(), pointer = vm.top.stack.at(-1);
    for (const invalid of [foreign.top.stack.at(-1), Object.freeze({...pointer}), vm.top.locals[3], null, 123]) {
      vm.restore(snapshot);
      vm.top.stack[vm.top.stack.length - 1] = invalid;
      const operands = [...vm.top.stack];
      assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, operands);
    }
  }));
});

test('metadata replacement rebuilds target and receiver tables before checking an existing allocation', () => {
  const bytes = fixture();
  withVM(bytes, vm => {
    pause(vm);
    const receiver = vm.top.stack[0];
    vm.inspector = new AssemblyInspector(bytes);
    vm.report = verifyCilAssembly(vm.inspector);
    assert.equal(vm.report.success, true);
    invalidateExecutionCode(vm, 'instance-calli-metadata-replacement');
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
    assert.equal(vm.heap.get(receiver).methodTable.registry, vm.typeSystem.methodTables);
  });
});

test('the selected frame roots its original receiver during host output and guest GC', () => {
  let vm, receiver, outputs = 0;
  try {
    vm = new CilVirtualMachine(fixture({trace: true}), {onOutput() {
      outputs++;
      receiver = vm.top.args[0];
      vm.frames[0].locals[0] = null;
      vm.heap.collect();
      assert.equal(vm.heap.get(receiver).data[0], 42);
    }});
    assert.equal(vm.run().returnValue, 42);
    assert.equal(outputs, 1);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
  } finally { vm?.stop(); }
});

test('instance calli retains field-triggered initialization and ordinary frame admission', () => {
  withVM(fixture({initialize: true}), vm => assert.equal(vm.run().returnValue, 48));
  withVM(fixture(), vm => {
    pause(vm);
    vm.options.maxFrames = vm.frames.length;
    vm.state = 'running';
    assert.equal(vm.run().fault?.name, 'StackOverflowException');
  });
});

for (const nativeIntBits of [32, 64]) test(`instance receiver and native pointer keep exact frame-byte admission at ABI${nativeIntBits}`, () => {
  for (const limit of [127, 128]) withVM(fixture({local: true, maxStack: 3}), vm => {
    pause(vm);
    const snapshot = vm.snapshot(), receiver = vm.top.stack[0];
    // Main: header16 + capacity3*8 + locals4*8 =72. Bump: header16 + capacity3*8 + args2*8 =56.
    vm.options.maxStackBytes = 71;
    assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
    assert.equal(vm.top.stack[0], receiver);
    vm.options.maxStackBytes = limit;
    vm.restore(snapshot);
    vm.state = 'running';
    const result = vm.run();
    if (limit === 128) assert.equal(result.returnValue, 42);
    else assert.equal(result.fault?.name, 'StackOverflowException');
  }, {nativeIntBits});
});

for (const callSignature of [{hasThis: false}, {returnType: scalar('long')}, {parameters: [scalar('long')]}]) {
  test(`mismatched instance StandAloneSig ${JSON.stringify(callSignature)} fails verification`, () => {
    const report = verifyCilAssembly(fixture({callSignature}));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /signature/.test(issue.message)));
  });
}

for (const callSignature of [{explicitThis: true}, {callingConvention: 1}, {callingConvention: 5, sentinel: 0}]) {
  test(`unsupported instance convention ${JSON.stringify(callSignature)} is rejected before projection`, () => {
    const report = verifyCilAssembly(fixture({callSignature}));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.exceptionType === 'NotSupportedException'));
  });
}

for (const location of ['parameter', 'return', 'field']) {
  test(`typed instance function-pointer ${location} is rejected without changing inspection formatting`, () => {
    const pointer = {kind: 'functionPointer', signature: signature()};
    const method = {name: 'Main', body: writer => writer.op('ret')};
    if (location === 'parameter') method.signature = encodeSignature(signature({hasThis: false,
      returnType: scalar('void'), parameters: [pointer]}));
    if (location === 'return') {
      method.signature = encodeSignature(signature({hasThis: false, returnType: pointer, parameters: []}));
      method.body = writer => writer.op('ldnull').op('ret');
    }
    const type = {name: 'Program', methods: [method]};
    if (location === 'field') {
      type.fields = [{name: 'Pointer', flags: 0x16, signature: encodeSignature({kind: 'field', type: pointer})}];
      method.body = (writer, context) => writer.op('ldsfld', context.fields.get('Program.Pointer')).op('pop').op('ret');
    }
    const inspector = new AssemblyInspector(genericCallFixture([type]));
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.exceptionType === 'NotSupportedException' && /function-pointer/.test(issue.message)));
  });
}

test('ExplicitThis instance targets remain unavailable even behind ordinary HasThis call sites', () => {
  const report = verifyCilAssembly(fixture({instanceSignature: {explicitThis: true}}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_CALLI'));
});

test('assigning an instance pointer into a native argument does not expand the local-only provenance scope', () => {
  const bytes = genericCallFixture([
    {name: 'Counter', methods: [constructor(), {name: 'Get', static: false, result: 'int',
      body: writer => writer.op('ldc.i4.7').op('ret')}]},
    {name: 'Program', methods: [
      {name: 'Main', result: 'int', body(writer, context) {
        writer.op('ldc.i4.0').op('conv.i').op('newobj', context.methods.get('Counter..ctor'));
        writer.op('call', context.methods.get('Program.Apply')).op('ret');
      }},
      {name: 'Apply', parameters: ['nint', 'Counter'], result: 'int', body(writer, context) {
        writer.op('ldftn', context.methods.get('Counter.Get')).op('starg.s', 0);
        writer.op('ldarg.1').op('ldarg.0').op('calli', standalone(context, {parameters: []})).op('ret');
      }}
    ]}
  ]);
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_CALLI' && issue.method === 'Program::Apply'));
});

for (const [name, ownerType] of [
  ['value', {name: 'Target', flags: 0x100109, base: 'System.ValueType'}],
  ['interface', {name: 'Target', interface: true, flags: 0xa1}],
  ['generic', {name: 'Target`1', genericParameters: [{}]}]
]) test(`${name} instance targets remain outside calli admission`, () => {
  const definition = {...ownerType, methods: [{name: 'Run', static: false, result: 'int', parameters: ['int'],
    body: writer => writer.op('ldarg.1').op('ret')}]};
  const report = verifyCilAssembly(fixture({ownerType: definition, target: definition.name + '.Run'}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => ['IL_CALLI', 'IL_TOKEN'].includes(issue.code)));
});

for (const prefix of ['tail.']) test(`${prefix} remains a separate calli feature`, () => {
  const report = verifyCilAssembly(fixture({prefix}));
  assert.equal(report.success, false);
});
