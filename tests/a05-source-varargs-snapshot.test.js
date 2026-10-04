import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileToIL
} from '@sharpforge/compiler';
import {
  loadAssembly
} from '@sharpforge/cil';
import {
  VirtualMachine,
  CilVirtualMachine,
  serializeSnapshot,
  restoreSerializedSnapshot
} from '@sharpforge/runtime';
import {
  sourceStore
} from '../packages/runtime/src/execution/source-storage.js';

const program = `using System;class Program {
  static int Sum(int initial,__arglist) {
    ArgIterator iterator=new ArgIterator(__arglist);
    Console.WriteLine("checkpoint");
    int total=initial+__refvalue(iterator.GetNextArg(),int);
    total+=__refvalue(iterator.GetNextArg(),string).Length;
    total+=__refvalue(iterator.GetNextArg(),int);
    iterator.End();
    return total;
  }
  static void Main(){Console.WriteLine(Sum(10,__arglist(4,"before".Substring(1),6)));}
}`;

function compile() {
  const compiled = compileToIL(program);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  return compiled;
}

function create(engine, compiled) {
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly) :
    new VirtualMachine(engine === 'source' ? compiled.image : loadAssembly(compiled.assembly));
}

function checkpoint(vm) {
  for (let step = 0; step < 2000 && !vm.output.join('').includes('checkpoint\n'); step++) {
    vm.runSlice({
      instructionBudget: 1,
      timeBudgetMs: 1000
    });
  }
  assert.equal(vm.output.join(''), 'checkpoint\n');
  const frame = vm.top;
  assert.equal(frame.varargs.length, 3);
  assert(frame.locals.some(value => value?.argIterator));
  return frame;
}

for (const engine of ['source', 'reloaded-source', 'cil']) {
  test(`T02.9 ${engine}: optional argument locations survive GC and fresh-VM portable replay`, async () => {
    const compiled = compile(),
      vm = create(engine, compiled);
    checkpoint(vm);
    vm.heap.collect();
    const wire = await serializeSnapshot(vm, vm.snapshot(), {
      json: true
    });
    vm.stop();
    vm.heap.collect();
    const restored = await restoreSerializedSnapshot(create(engine, compiled), wire);
    restored.heap.collect();
    const result = restored.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, 'checkpoint\n25\n');
  });

  test(`T02.9 ${engine}: packet and iterator corruption are rejected before restore mutation`, () => {
    const vm = create(engine, compile());
    checkpoint(vm);
    const frames = vm.frames;
    const packet = vm.snapshot();
    packet.frames.at(-1).varargs[0].index++;
    assert.throws(() => vm.restore(packet), /varargs snapshot/);
    const expired = vm.snapshot(),
      locals = expired.frames.at(-1).locals;
    const slot = locals.findIndex(value => value?.argIterator);
    locals[slot] = Object.freeze({
      ...locals[slot],
      frameId: expired.frameId + 1
    });
    assert.throws(() => vm.restore(expired), /runtime argument frame|expired (?:runtime argument )?handle/);
    assert.equal(vm.frames, frames);
  });
}

test('T02.9 source runtime argument values preserve exact type and VM ownership', () => {
  const compiled = compile(),
    vm = create('source', compiled),
    foreign = create('source', compiled);
  const frame = checkpoint(vm),
    iterator = frame.locals.find(value => value?.argIterator);
  assert.equal(sourceStore(vm, iterator, 'System.ArgIterator'), iterator);
  assert.throws(() => sourceStore(foreign, iterator, 'System.ArgIterator'), {
    name: 'InvalidProgramException'
  });
  assert.throws(() => sourceStore(vm, iterator, 'object'), {
    name: 'InvalidCastException'
  });
  assert.throws(() => sourceStore(vm, {
    ...iterator
  }, 'System.ArgIterator'), {
    name: 'InvalidProgramException'
  });
});
