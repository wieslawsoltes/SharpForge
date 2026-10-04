import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const routes = {
  source: program => new VirtualMachine(program.image),
  reloaded: program => new VirtualMachine(loadAssembly(program.assembly)),
  cil: program => new CilVirtualMachine(program.assembly)
};

function atReturn(vm) {
  const frame = vm.top;
  return frame?.objectStringReturn && (vm.inspector ? frame.method.instructions[frame.pc]?.name === 'ret'
    : vm.image.methods[frame.methodId].code[frame.pc * 3] === Op.RET);
}

for (const [name, create] of Object.entries(routes)) {
  test(`Object.ToString ${name}: return contract survives local and portable snapshots`, async () => {
    const program = compileToIL(`using System;
      class Value { public override string ToString() { return "managed"; } }
      class Program { static void Main() { object value = new Value(); Console.WriteLine(value.ToString()); } }`);
    assert(program.success, JSON.stringify(program.diagnostics));
    const vm = create(program), fresh = create(program);
    try {
      for (let step = 0; step < 100 && !atReturn(vm); step++) vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      assert(atReturn(vm));
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
      await restoreSerializedSnapshot(fresh, wire);
      for (const replay of [vm, fresh]) {
        replay.heap.collect();
        assert.equal(replay.run().output, 'managed\n');
        assert.equal(replay.state, 'terminated');
      }
      vm.restore(saved);
      assert.equal(vm.top.objectStringReturn, true);
      const stack = vm.inspector ? vm.top.stack : vm.stack;
      stack[stack.length - 1] = 17;
      assert.equal(vm.run().fault?.name, 'InvalidProgramException');
      assert.equal(vm.output.join(''), '');
      const bad = {...saved, frames: saved.frames.map(frame => frame.objectStringReturn
        ? {...frame, objectStringReturn: 'yes'} : frame)};
      assert.throws(() => vm.restore(bad), /Object.ToString return continuation/);
    } finally { vm.stop(); fresh.stop(); }
  });
}

test('Object.ToString CIL: a tail-called body retains the string return contract', () => {
  const bytes = genericCallFixture([
    {name: 'Value', methods: [
      {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
        writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
      }},
      {name: 'ToString', static: false, flags: 0xc6, result: 'string', body(writer, context) {
        writer.op('tail.').op('call', context.methods.get('Value.Invalid')).op('ret');
      }},
      {name: 'Invalid', result: 'string', body: writer => writer.op('ldc.i4.1').op('ret')}
    ]},
    {name: 'Program', methods: [{name: 'Main', result: 'string', body(writer, context) {
      writer.op('newobj', context.methods.get('Value..ctor'))
        .op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('ret');
    }}]}
  ]);
  const vm = new CilVirtualMachine(bytes);
  try {
    assert.equal(vm.run().fault?.name, 'InvalidProgramException');
  } finally { vm.stop(); }
});
