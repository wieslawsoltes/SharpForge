import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {dispatchSourceOpcode,sourceOpcodeHandlers} from '../packages/runtime/src/execution/source-ops/index.js';
import {image} from './helpers.js';

const run = source => {
  const vm = new VirtualMachine(image(source));
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return result.output;
};

test('A00 source dispatch maps every released opcode to an immutable handler', () => {
  assert(Object.isFrozen(sourceOpcodeHandlers));
  assert.equal(sourceOpcodeHandlers.length, Object.keys(Op).length);
  for (const [name, opcode] of Object.entries(Op)) assert.equal(typeof sourceOpcodeHandlers[opcode], 'function', name);
  assert.equal(sourceOpcodeHandlers[-1], undefined);
  assert.equal(sourceOpcodeHandlers[sourceOpcodeHandlers.length], undefined);
});

test('A00 grouped dispatcher distinguishes no-op handlers from unknown instructions', () => {
  for (const op of [Op.SEQ, Op.NOP]) assert.equal(dispatchSourceOpcode(null, null, op, 0, 0), true);
  const coercedOpcode = {toString() { throw new Error('Opcode must not be coerced'); }};
  for (const op of [-1, sourceOpcodeHandlers.length, '0', 'constructor', 'map', '__proto__', 'toString',
    0n, Object(0), 1.5, NaN, Infinity, undefined, null, Symbol('opcode'), coercedOpcode]) {
    assert.equal(dispatchSourceOpcode(null, null, op, 0, 0), false);
  }
});

test('A00 grouped source dispatch retains array loops, calls, arithmetic and finally order', () => {
  assert.equal(run(`
    int Sum(int[] values) {
      int total = 0;
      for (int i = 0; i < values.Length; i++) { total += values[i]; }
      try { return checked(total + (int)3.9); }
      finally { Console.WriteLine("cleanup"); }
    }
    int[] values = new int[2]; values[0] = 3; values[1] = 4;
    Console.WriteLine(Sum(values));
    Console.WriteLine(-values[0]);
  `), 'cleanup\n10\n-3\n');
});

test('A00 source stores preserve the assigned stack value and notify after mutation', () => {
  const frame = {id: 7, methodId: 0, locals: [1]}, writes = [];
  // Typed stores use the declared destination metadata before notifying observers.
  const program = {methods: [{locals: [{type: 'int'}]}], statics: [{type: 'int'}]};
  const vm = {image: program, stack: [9], statics: [2], notifyWrite(write) {
    assert.equal(write.kind === 'local' ? frame.locals[write.index] : this.statics[write.index], write.value);
    writes.push(write);
  }};
  assert.equal(dispatchSourceOpcode(vm, frame, Op.STLOC, 0, 0), true);
  assert.equal(dispatchSourceOpcode(vm, frame, Op.STSTATIC, 0, 0), true);
  assert.deepEqual(vm.stack, [9]);
  assert.deepEqual(writes, [
    {kind: 'local', frameId: 7, index: 0, value: 9, oldValue: 1},
    {kind: 'static', index: 0, value: 9, oldValue: 2}
  ]);
  assert.throws(() => dispatchSourceOpcode({stack: []}, {locals: [undefined]}, Op.LDLOC, 0, 0),
    {name: 'InvalidProgramException', message: 'Read of uninitialized local'});
});

test('A00 source dispatch pauses at a sequence point before consuming its instruction', () => {
  const vm = new VirtualMachine(image('Console.WriteLine(42);'));
  let paused;
  vm.runSlice({onSequence(point, frame) {
    paused = {frame, pc: frame.pc, instructions: vm.instructions, point};
    return true;
  }});
  assert(paused);
  assert.equal(vm.state, 'paused');
  assert.equal(paused.frame.pc, paused.pc);
  assert.equal(vm.instructions, paused.instructions);
  assert.equal(vm.currentPoint, paused.point);
  assert.equal(vm.run().output, '42\n');
});

test('A00 source dispatch keeps invalid opcodes and arithmetic boundaries as managed faults', () => {
  for (const opcode of [-1, sourceOpcodeHandlers.length]) {
    const program = image('Console.WriteLine(1);'), vm = new VirtualMachine(program);
    program.methods[program.entryPoint].code[0] = opcode;
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'InvalidProgramException');
  }
  const vm = new VirtualMachine(image('int maximum = int.Parse("2147483647"); Console.WriteLine(checked(maximum + 1));'));
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'OverflowException');
});
