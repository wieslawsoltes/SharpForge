import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {AssemblyInspector, encodeSignature, verifyCilAssembly, parseFunctionPointerType} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

const scalar = name => ({kind: 'primitive', name});
const signature = (result = scalar('int'), parameters = [scalar('int')], options = {}) =>
  ({kind: 'method', hasThis: false, returnType: result, parameters, ...options});
const pointer = (options = {}) => ({kind: 'functionPointer', signature: signature(undefined, undefined, options)});
const standalone = (context, value = signature()) => context.md.add(17, [context.md.blob(encodeSignature(value))]);
const increment = {name: 'Increment', result: 'int', parameters: ['int'], body: writer => writer
  .op('ldarg.0').op('ldc.i4.1').op('add').op('ret')};

function fixture({join = false, mismatch = false, uninitialized = false, typed = true, convention = 0,
  instance = false, maxStack = 16, addressed = false} = {}) {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', locals: ['nint'], maxStack,
      ...(typed ? {localsSignature: encodeSignature({kind: 'locals', types: [pointer()]})} : {}),
      body(writer, context) {
        if (addressed) writer.op('ldloca.s', 0).op('pop');
        if (join) writer.op('ldc.i4.0').op('brfalse.s', 'other');
        if (!uninitialized) writer.op('ldftn', context.methods.get('Program.Increment')).op('stloc.0');
        if (join) writer.op('br.s', 'invoke').mark('other');
        if (join || mismatch) writer.op('ldftn', context.methods.get(mismatch ? 'Program.Long' : 'Program.Increment')).op('stloc.0');
        if (join) writer.mark('invoke');
        writer.op('ldc.i4', 41).op('ldloc.0').op('calli', standalone(context,
          signature(undefined, undefined, {callingConvention: convention, hasThis: instance}))).op('ret');
      }}, increment,
    {name: 'Long', result: 'long', parameters: ['int'], body: writer => writer.op('ldarg.0').op('conv.i8').op('ret')}
  ]}]);
}

test('managed calli executes typed and native-int locals with compatible control-flow joins', () => {
  for (const typed of [false, true]) for (const join of [false, true]) {
    const vm = new CilVirtualMachine(fixture({typed, join}));
    try { assert.equal(vm.run().returnValue, 42); assert.equal(vm.state, 'terminated'); }
    finally { vm.stop(); }
  }
});

test('signature mismatch and uninitialized provenance fail before guest execution', () => {
  for (const options of [{mismatch: true}, {mismatch: true, join: true, typed: false}, {uninitialized: true}]) {
    const report = verifyCilAssembly(fixture(options));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /signature/.test(issue.message)));
    assert.throws(() => new CilVirtualMachine(fixture(options)), /signature/);
  }
});

test('unmanaged and instance calli admission produces a structured unsupported exception', () => {
  for (const options of [{convention: 1}, {convention: 2}, {instance: true}]) {
    const report = verifyCilAssembly(fixture(options));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.exceptionType === 'NotSupportedException'));
    assert.throws(() => new CilVirtualMachine(fixture(options)), error => error.name === 'NotSupportedException' &&
      error.member === 'Program::Main' && error.callingConvention === (options.convention ?? 0));
  }
});

test('execution reads fnptr convention flags from the AST while inspection strings remain unchanged', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'void',
    localsSignature: encodeSignature({kind: 'locals', types: [pointer({callingConvention: 1})]}), body: writer => writer.op('ret')}]}]);
  const inspector = new AssemblyInspector(bytes), method = inspector.getMethod(inspector.pe.entryPoint);
  assert.equal(method.locals[0], 'method int *(int)');
  const report = verifyCilAssembly(inspector);
  assert(report.issues.some(issue => issue.code === 'IL_UNMANAGED' && issue.callingConvention === 1));
  assert.deepEqual(parseFunctionPointerType('method int *(int)').parameters, ['int']);
  assert.equal(parseFunctionPointerType('int'), null);
});

test('typed pointer arguments, fields and pointers returned through calli retain exact identity', () => {
  const functionType = pointer(), factoryType = {kind: 'functionPointer', signature: signature(functionType, [])};
  const bytes = genericCallFixture([{name: 'Program', fields: [
    {name: 'Target', flags: 0x16, signature: encodeSignature({kind: 'field', type: functionType})}
  ], methods: [
    {name: 'Main', result: 'int', localsSignature: encodeSignature({kind: 'locals', types: [functionType, factoryType]}),
      body(writer, context) {
        writer.op('ldftn', context.methods.get('Program.Increment')).op('stloc.0')
          .op('ldloc.0').op('stsfld', context.fields.get('Program.Target'))
          .op('ldsfld', context.fields.get('Program.Target')).op('ldc.i4', 6)
          .op('call', context.methods.get('Program.Apply')).op('pop')
          .op('ldftn', context.methods.get('Program.Create')).op('stloc.1')
          .op('ldc.i4', 41).op('ldloc.1').op('calli', standalone(context, signature(functionType, [])))
          .op('calli', standalone(context)).op('ret');
      }}, increment,
    {name: 'Apply', signature: encodeSignature(signature(scalar('int'), [functionType, scalar('int')])),
      body: (writer, context) => writer.op('ldarg.1').op('ldarg.0').op('calli', standalone(context)).op('ret')},
    {name: 'Create', signature: encodeSignature(signature(functionType, [])),
      body: (writer, context) => writer.op('ldftn', context.methods.get('Program.Increment')).op('ret')}
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  try { assert.equal(vm.run().returnValue, 42); assert.equal(vm.state, 'terminated'); }
  finally { vm.stop(); }
});

test('direct callers cannot pass integer-forged pointer arguments even without their own calli', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4.0').op('conv.i')
      .op('ldc.i4.1').op('call', context.methods.get('Program.Apply')).op('ret')},
    {name: 'Apply', signature: encodeSignature(signature(scalar('int'), [pointer(), scalar('int')])),
      body: (writer, context) => writer.op('ldarg.1').op('ldarg.0').op('calli', standalone(context)).op('ret')}
  ]}]);
  assert(verifyCilAssembly(bytes).issues.some(issue => issue.code === 'IL_CALLI' && issue.method === 'Program::Main'));
});

test('opaque ldftn ownership survives GC and replay; copied and foreign carriers fail before argument consumption', () => {
  const vm = new CilVirtualMachine(fixture()), foreign = new CilVirtualMachine(fixture());
  const pause = machine => machine.runSlice({instructionBudget: 100, timeBudgetMs: 1000,
    onInstruction: instruction => instruction.name === 'calli'});
  try {
    pause(vm); pause(foreign);
    const actual = vm.top.stack.at(-1), snapshot = vm.snapshot();
    vm.heap.collect();
    vm.restore(snapshot);
    assert.equal(vm.top.stack.at(-1), actual);
    for (const invalid of [Object.freeze({...actual}), foreign.top.stack.at(-1), 123, null]) {
      vm.top.stack[vm.top.stack.length - 1] = invalid;
      const stack = [...vm.top.stack];
      assert.throws(() => vm.step(), {name: 'InvalidProgramException'});
      assert.deepEqual(vm.top.stack, stack);
      vm.restore(snapshot);
    }
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
  } finally { vm.stop(); foreign.stop(); }
});

test('calli enters the existing initializer and frame-limit paths', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op('ldc.i4', 7).op('ldftn', context.methods.get('Counter.Add')).op('calli', standalone(context)).op('ret');
  }}]}, {name: 'Counter', flags: 1, fields: [{name: 'Value', type: 'int', flags: 0x16}], methods: [
    {name: '.cctor', flags: 0x1891, body: (writer, context) => writer.op('ldc.i4.5')
      .op('stsfld', context.fields.get('Counter.Value')).op('ret')},
    {name: 'Add', result: 'int', parameters: ['int'], body: (writer, context) => writer.op('ldarg.0')
      .op('ldsfld', context.fields.get('Counter.Value')).op('add').op('ret')}
  ]}]);
  const vm = new CilVirtualMachine(bytes), limited = new CilVirtualMachine(fixture(), {maxFrames: 1});
  try {
    assert.equal(vm.run().returnValue, 12);
    assert.equal(limited.run().state, 'faulted');
    assert.equal(limited.fault.name, 'StackOverflowException');
  } finally { vm.stop(); limited.stop(); }
});

test('wrong token kind and incompatible declared pointer stores are verification errors', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4.1')
      .op('ldftn', context.methods.get('Program.Increment')).op('calli', context.methods.get('Program.Increment')).op('ret')}, increment
  ]}]);
  assert(verifyCilAssembly(bytes).issues.some(issue => issue.code === 'IL_CALLI' && /StandAloneSig/.test(issue.message)));
  assert(verifyCilAssembly(fixture({mismatch: true})).issues.some(issue => issue.code === 'IL_CALLI'));
});

test('analysis uses proven peak rather than header capacity and declines address-escaped native slots', () => {
  assert.equal(verifyCilAssembly(fixture({maxStack: 65535})).success, true);
  const report = verifyCilAssembly(fixture({typed: false, addressed: true}));
  assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /signature/.test(issue.message)));
});

test('large pointer-flow state fails with an explicit bounded-analysis diagnostic', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', locals: ['nint', ...Array(1000).fill('int')], body(writer, context) {
      writer.op('ldftn', context.methods.get('Program.Increment')).op('stloc.0');
      for (let index = 0; index < 300; index++) writer.op('nop');
      writer.op('ldc.i4.1').op('ldloc.0').op('calli', standalone(context)).op('ret');
    }}, increment
  ]}]);
  const report = verifyCilAssembly(bytes);
  assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /analysis budget/.test(issue.message)));
});


test('instance pointer fields use native physical storage and keep their exact callable signature', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', locals: ['Holder'], body(writer, context) {
      writer.op('newobj', context.methods.get('Holder..ctor')).op('stloc.0')
        .op('ldloc.0').op('ldftn', context.methods.get('Program.Increment'))
        .op('stfld', context.fields.get('Holder.Target'))
        .op('ldc.i4', 41).op('ldloc.0').op('ldfld', context.fields.get('Holder.Target'))
        .op('calli', standalone(context)).op('ret');
    }}, increment
  ]}, {name: 'Holder', fields: [
    {name: 'Target', signature: encodeSignature({kind: 'field', type: pointer()})},
    {name: 'ArrayTarget', signature: encodeSignature({kind: 'field', type: {kind: 'functionPointer',
      signature: signature(scalar('int'), [{kind: 'szarray', element: scalar('int')}])}})}
  ], methods: [{name: '.ctor', static: false, body: writer => writer.op('ret')}]}]);
  const vm = new CilVirtualMachine(bytes);
  try {
    const holder = vm.typeSystem.table('Holder');
    assert.deepEqual(holder.gcBitmap, [false, false]);
    assert.equal(holder.fields[1].storageType, 'method int *(int[])');
    vm.runSlice({instructionBudget: 100, timeBudgetMs: 1000, onInstruction: instruction => instruction.name === 'calli'});
    const address = vm.address('field', 0, vm.top.locals[0]);
    assert.throws(() => vm.dereference(address, true, 0), {name: 'InvalidProgramException'});
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 42);
  } finally { vm.stop(); }
});
