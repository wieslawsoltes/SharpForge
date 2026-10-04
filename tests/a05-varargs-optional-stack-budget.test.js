import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, decimalParse} from '@sharpforge/bytecode';
import {methodSignature} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

const overflow = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};
const fields = ['First', 'Second', 'Third'].map(name => ({name, type: 'long', flags: 6}));
const cases = [
  {name: 'Decimal', type: 'decimal', width: 16},
  {name: 'large struct', type: 'Wide', width: 24},
  {name: 'large struct byref', type: 'Wide', width: 24, byref: true}
];

function sourceImage({type, byref}) {
  const method = (id, code, locals = []) => ({id, name: id ? 'Take' : 'Main', qualifiedName: id ? 'Take' : 'Main',
    owner: null, isStatic: true, returnType: 'int', parameters: [], handlers: [], locals,
    callingConvention: id ? 5 : 0, code: Int32Array.from(code)});
  const initialize = type === 'decimal' ? [Op.CONST, 1, 0, Op.STLOC, 0, 0, Op.POP, 0, 0] : [];
  const argument = byref ? [Op.ADDRESS, 1, 0] : [Op.LDLOC, 0, 0];
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [42, decimalParse('1.25')],
    types: [{id: 0, name: 'Wide', valueType: true, fields: fields.map((field, slot) => ({...field, slot}))}],
    statics: [], sources: [], sequencePoints: [], methods: [
      method(0, [...initialize, ...argument, Op.CALL, 1, 1, Op.RET, 0, 0], [{name: 'payload', type, slot: 0}]),
      method(1, [Op.CONST, 0, 0, Op.RET, 0, 0])
    ]};
}

function cilImage({type, byref}) {
  const localType = type === 'Wide' || type.startsWith('Triple') ? 'valuetype ' + type : type;
  return controlFixture([
    {name: 'Wide', base: 'System.ValueType', flags: 0x100109, fields, methods: []},
    {name: 'Triple`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
      fields: fields.map(field => ({...field, type: '!0'})), methods: []},
    {name: 'Program', methods: [
      {name: 'Main', result: 'int', maxStack: 1, locals: [localType], body(writer, context) {
        const signature = methodSignature('int', [localType + (byref ? '&' : '')], true, context.resolve,
          {callingConvention: 5, sentinel: 0});
        const target = context.md.member(context.methods.get('Program.Take'), 'Take', signature);
        writer.op(byref ? 'ldloca.s' : 'ldloc.s', 0).op('call', target).op('ret');
      }},
      {name: 'Take', result: 'int', maxStack: 1, signature: Uint8Array.from([5, 0, 8]),
        body: writer => writer.op('ldc.i4', 42).op('ret')}
    ]}
  ]);
}

function pauseAtCallee(vm) {
  for (let count = 0; count < 30 && vm.frames.length < 2 && vm.state !== 'faulted'; count++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
  }
  assert.equal(vm.frames.length, 2, vm.fault?.stack);
  assert.equal(vm.top.varargs.length, 1);
}

for (const engine of ['source', 'cil']) for (const nativeIntBits of [32, 64]) {
  const variants = engine === 'cil' ? [...cases, {name: 'closed generic struct', type: 'Triple`1<decimal>', width: 48}] : cases;
  for (const variant of variants) test(`${engine} ABI${nativeIntBits}: optional ${variant.name} retains its complete stack charge`, () => {
    const input = engine === 'source' ? sourceImage(variant) : cilImage(variant);
    const VM = engine === 'source' ? VirtualMachine : CilVirtualMachine;
    const total = 48 + variant.width + (variant.byref ? 8 : variant.width);
    const rejected = new VM(input, {nativeIntBits, maxStackBytes: total - 1});
    try {
      const allocations = framePoolStatistics(rejected).framesAllocated;
      const result = rejected.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, overflow.name);
      assert.equal(result.fault.message, overflow.message);
      assert.equal(rejected.frames.length, 1, 'the rejected callee never gains a live frame');
      assert.equal(framePoolStatistics(rejected).framesAllocated, allocations, 'rejection precedes pool allocation');
    } finally { rejected.stop(); }

    const vm = new VM(input, {nativeIntBits, maxStackBytes: total});
    try {
      pauseAtCallee(vm);
      const snapshot = vm.snapshot();
      vm.options.maxStackBytes--;
      const frames = vm.frames;
      assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
      assert.equal(vm.frames, frames, 'snapshot quota rejection precedes mutation');
      const pc = vm.top.pc;
      if (engine === 'cil') assert.throws(() => vm.step(), overflow);
      else {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
        assert.equal(vm.fault?.name, overflow.name);
      }
      assert.equal(vm.top.pc, pc, 'lowering the active quota rejects before the callee executes');
      vm.options.maxStackBytes++;
      vm.restore(snapshot);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.returnValue, 42);
    } finally { vm.stop(); }
  });
}
