import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyCilAssembly} from '@sharpforge/cil';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture(operation, {throwing = false, width = 0} = {}) {
  const equals = operation === 'Equals', result = equals ? 'bool' : 'int';
  const fields = width ? Array.from({length: width}, (_, index) => ({name: 'N' + index, type: 'int'}))
    : [{name: 'Reference', type: 'Field'}, {name: 'Number', type: 'int'}];
  fields.push({name: 'Text', type: 'string'});
  return genericCallFixture([
    {name: 'Field', methods: [
      {name: '.ctor', static: false, body: writer => writer.op('ret')},
      {name: operation, static: false, flags: 0xc6, result, parameters: equals ? ['object'] : [], body(writer, context) {
        if (throwing) { writer.op('ldnull').op('throw'); return; }
        writer.op('call', context.member('System.GC', 'Collect', 'void'))
          .op('ldc.i4', equals ? 1 : 37).op('ret');
      }}
    ]},
    {name: 'Pair', base: 'System.ValueType', flags: 0x100109, fields, methods: []},
    {name: 'Program', methods: [{name: 'Main', result, locals: ['valuetype Pair', 'valuetype Pair'], body(writer, context) {
      if (!width) writer.op('ldloca.s', 0).op('newobj', context.methods.get('Field..ctor')).op('stfld', context.fields.get('Pair.Reference'));
      writer.op('ldloca.s', 0).op('ldstr', 0x70000000 + context.md.userString('x'.repeat(width ? 2048 : 4)))
        .op('stfld', context.fields.get('Pair.Text')).op('ldloc.0').op('stloc.1');
      if (!width) writer.op('ldloca.s', 1).op('newobj', context.methods.get('Field..ctor')).op('stfld', context.fields.get('Pair.Reference'));
      writer.op('ldloca.s', 0);
      if (equals) writer.op('ldloc.1').op('box', context.resolve('Pair'));
      writer.op('constrained.', context.resolve('Pair'))
        .op('callvirt', context.member('System.Object', operation, result, equals ? ['object'] : [], false)).op('ret');
    }}]}
  ]);
}

function make(operation, options = {}, runtimeOptions = {}) {
  const bytes = fixture(operation, options), report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  return new CilVirtualMachine(bytes, {weakStringInterning: true, ...runtimeOptions});
}

for (const operation of ['Equals', 'GetHashCode']) test(`default ValueType.${operation} invokes managed field overrides through ordinary frames`, () => {
  const vm = make(operation);
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: (_instruction, frame) => frame.method.owner === 'Field' && frame.method.name === operation});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.top.method.name, operation);
    assert.equal(vm.top.objectValueContinuation.operation, operation);
    assert.equal(vm.top.objectValueContinuation.nodes.at(-1).phase, 'waiting');
    const saved = vm.snapshot();
    let expected;
    for (let replay = 0; replay < 2; replay++) {
      if (replay) vm.restore(saved);
      vm.heap.collect();
      vm.state = 'running';
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      if (operation === 'Equals') assert.equal(vm.returnValue, 1, 'distinct reference fields compare through their override');
      else assert.equal(Number.isInteger(vm.returnValue), true);
      if (replay) assert.equal(vm.returnValue, expected);
      expected = vm.returnValue;
      vm.heap.collect();
    }
  } finally { vm.stop(); }
});

for (const operation of ['Equals', 'GetHashCode']) test(`an unhandled ${operation} field fault preserves inspection and releases work on stop`, () => {
  const vm = make(operation, {throwing: true});
  try {
    assert.equal(vm.run().fault?.name, 'NullReferenceException');
    assert.equal(vm.top.method.name, operation);
    assert.equal(vm.top.objectValueContinuation.operation, operation);
    vm.stop();
    assert.equal(vm.frames.length, 0);
    vm.heap.collect();
    assert.equal(vm.heap.records.filter(record => record?.kind === 'box').length, 0);
  } finally { vm.stop(); }
});

for (const operation of ['Equals', 'GetHashCode']) test(`${operation} field and string work yields, charges instructions, replays and cancels`, () => {
  const vm = make(operation, {width: 128}, {runtimeEvents: true, maxInstructions: 10000});
  try {
    for (let count = 0; count < 100 && !vm.top?.objectValueWork; count++) {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert(vm.top.objectValueWork);
    const saved = vm.snapshot(), before = vm.instructions;
    const text = vm.top.locals[0].fields.at(-1);
    vm.heap.collect();
    assert.equal(vm.heap.get(text).data.length, 2048);
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.equal(vm.instructions, before + 1);
    assert(vm.top.objectValueWork, 'one quantum cannot scan the whole value');
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    const expected = vm.returnValue;
    vm.heap.collect();
    assert.throws(() => vm.heap.get(text), {name: 'InvalidReferenceException'});
    vm.restore(saved);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, expected);
    vm.restore(saved);
    vm.stop();
    vm.heap.collect();
    assert.equal(vm.frames.length, 0);
    assert.throws(() => vm.heap.get(text), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});
