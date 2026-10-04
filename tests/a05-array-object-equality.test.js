import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyCilAssembly} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {indexOfArray} from '../packages/runtime/src/execution/array-runtime.js';
import {managedFixture} from './managed-fixtures.js';

function fixture({valueType = false, throwing = false, hidden = false} = {}) {
  return genericCallFixture([
    {name: 'Receiver', base: valueType ? 'System.ValueType' : 'System.Object', flags: valueType ? 0x100109 : 0x100001,
      fields: [{name: 'X', type: 'int'}], methods: [
        {name: '.ctor', static: false, body: writer => writer.op('ret')},
        {name: 'Equals', static: false, flags: hidden ? 0x1c6 : 0xc6, result: 'bool', parameters: ['object'], body(writer, context) {
          if (throwing) { writer.op('ldnull').op('throw'); return; }
          writer.op('call', context.member('System.GC', 'Collect', 'void'))
            .op('ldarg.0').op('ldfld', context.fields.get('Receiver.X')).op('ldc.i4.2').op('ceq').op('ret');
        }}
      ]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', locals: [(valueType ? 'valuetype ' : '') + 'Receiver[]'],
      body(writer, context) {
        const type = context.resolve('Receiver'), field = context.fields.get('Receiver.X');
        writer.op('ldc.i4.3').op('newarr', type).op('stloc.0');
        for (let index = 0; index < 3; index++) {
          writer.op('ldloc.0').op('ldc.i4', index);
          if (valueType) writer.op('ldelema', type).op('ldc.i4', index).op('stfld', field);
          else writer.op('newobj', context.methods.get('Receiver..ctor')).op('dup')
            .op('ldc.i4', index).op('stfld', field).op('stelem.ref');
        }
        writer.op('ldloc.0').op('ldloc.0').op('ldc.i4.0');
        if (valueType) writer.op('ldelem', type).op('box', type);
        else writer.op('ldelem.ref');
        writer.op('call', context.member('System.Array', 'IndexOf', 'int', ['System.Array', 'object'])).op('ret');
      }}]}
  ]);
}

function make(options) {
  const bytes = fixture(options), report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  return new CilVirtualMachine(bytes, {weakStringInterning: true});
}

for (const valueType of [false, true]) test(`IndexOf invokes ${valueType ? 'value' : 'reference'} overrides and resumes one comparison`, () => {
  const vm = make({valueType});
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: (_instruction, frame) => frame.method.owner === 'Receiver' && frame.method.name === 'Equals'});
    assert.equal(vm.state, 'paused');
    const owner = vm.frames.at(-2), state = owner.intrinsicContinuation;
    assert.equal(state.comparisonPending, true);
    assert.equal(state.index, 0, 'the cursor waits for the managed result');
    assert.equal(vm.top.objectValueContinuation.capture, true);
    const saved = vm.snapshot();
    for (let replay = 0; replay < 2; replay++) {
      if (replay) vm.restore(saved);
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.returnValue, 2, 'the override controls equality even when the first element is the search object');
      vm.heap.collect();
    }
    vm.restore(saved);
    vm.stop();
    vm.heap.collect();
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.heap.records.filter(record => record?.kind === 'box').length, 0);
  } finally { vm.stop(); }
});

for (const valueType of [false, true]) test(`IndexOf ignores a hidden new slot for ${valueType ? 'value' : 'reference'} elements`, () => {
  const vm = make({valueType, hidden: true});
  try {
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 0);
  } finally { vm.stop(); }
});

test('an unhandled equality fault preserves the current comparison for inspection until stop', () => {
  const vm = make({throwing: true});
  try {
    assert.equal(vm.run().fault?.name, 'NullReferenceException');
    assert.equal(vm.frames.at(-2).intrinsicContinuation.index, 0);
    vm.stop();
    assert.equal(vm.frames.length, 0);
    vm.heap.collect();
    assert.equal(vm.heap.records.filter(record => record?.kind === 'box').length, 0);
  } finally { vm.stop(); }
});

test('a synchronous host array helper does not enter a managed equality body', () => {
  const vm = make({});
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: instruction => instruction.name === 'call'});
    const frame = vm.top, array = frame.locals[0], value = vm.heap.get(array).data[0];
    assert.throws(() => indexOfArray(vm, array, value), /require cooperative execution/);
    assert.equal(vm.top, frame);
    assert.equal(frame.objectValueWork, undefined);
    assert.equal(frame.intrinsicContinuation, undefined);
  } finally { vm.stop(); }
});

test('an equality callback can catch its own fault and still return into the pending array search', () => {
  const bytes = managedFixture({fields: [{name: 'X', static: false}], methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4.1').op('newarr', context.type).op('dup').op('ldc.i4.0')
        .op('newobj', context.methods['.ctor']).op('stelem.ref').op('ldnull')
        .op('call', context.member('System.Array', 'IndexOf', 'int', ['System.Array', 'object'])).op('ret');
    }},
    {name: '.ctor', static: false, body: writer => writer.op('ret')},
    {name: 'Equals', static: false, flags: 0xc6, result: 'bool', parameters: ['object'], body(writer) {
      writer.mark('try').op('ldc.i4.1').op('ldc.i4.0').op('div').op('pop').op('leave.s', 'done')
        .mark('catch').op('pop').op('leave.s', 'done').mark('done').op('ldc.i4.1').op('ret');
    }, handlers: (labels, context) => [{start: labels.get('try'), end: labels.get('catch'),
      target: labels.get('catch'), handlerEnd: labels.get('done'), catchType: context.resolve('System.DivideByZeroException')}]}
  ]});
  assert.equal(verifyCilAssembly(bytes).success, true);
  const vm = new CilVirtualMachine(bytes);
  try {
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 0);
  } finally { vm.stop(); }
});
