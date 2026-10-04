import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const source = `using System;
struct Counter {
  public int Value;
  public override string ToString(){Value++;GC.Collect();return "counter";}
}
class P {
  static string Read(in Counter? value){return value.ToString();}
  static void Main(){Counter counter=default(Counter);counter.Value=4;Counter? value=counter;
    Console.WriteLine(value.ToString());Console.WriteLine(value.Value.Value);
    Console.WriteLine(Read(in value));Console.WriteLine(value.Value.Value);
    Console.WriteLine(((Counter?)counter).ToString());Console.WriteLine(counter.Value);
    Counter? empty=null;Console.WriteLine(empty.ToString());}
}`;
const compiled = compileToIL(source);
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const create = engine => engine === 'cil' ? new CilVirtualMachine(compiled.assembly, {weakStringInterning: true})
  : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, {weakStringInterning: true});
const expected = 'counter\n5\ncounter\n5\ncounter\n4\n\n';

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: Nullable.ToString mutates a writable payload and defensively copies in and temporary receivers`, () => {
    const vm = create(engine);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`${engine}: Nullable payload address survives suspended override capture after original frame retirement`, async () => {
    const vm = create(engine);
    for (let step = 0; step < 3000; step++) {
      const frame = vm.top, method = frame?.method ?? vm.image?.methods[frame?.methodId];
      if (method?.owner === 'Counter' && method.name === 'ToString') break;
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    const self = vm.inspector ? vm.top.args[0] : vm.top.locals[0];
    assert.equal(self?.byref, true);
    assert(self.path.includes('nullableValue'));
    const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
    const invalid = vm.snapshot(), frame = invalid.frames.at(-1), slots = vm.inspector ? frame.args : frame.locals;
    slots[0] = Object.freeze({...slots[0], path: Object.freeze(['notNullableValue'])});
    const frames = vm.frames, records = vm.heap.records;
    assert.throws(() => vm.restore(invalid), TypeError);
    assert.equal(vm.frames, frames);assert.equal(vm.heap.records, records);
    vm.stop();vm.heap.collect();
    const fresh = create(engine);
    await restoreSerializedSnapshot(fresh, wire);
    vm.restore(saved);
    for (const replay of [vm, fresh]) {
      replay.heap.collect();
      if (replay.state === 'paused') replay.state = 'running';
      const result = replay.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
      replay.stop();
    }
  });
}

for (const engine of ['source', 'reload', 'cil']) test(`${engine}: Nullable primitive text preserves Boolean Char and unsigned storage`, () => {
  const compiled = compileToIL(`using System;class P {static void Main(){
    bool? yes=true,no=false;char? letter='A';uint? unsigned=4294967295U;ulong? wide=18446744073709551615UL;
    Console.WriteLine(yes.ToString());Console.WriteLine(no.ToString());Console.WriteLine(letter.ToString());
    Console.WriteLine(unsigned.ToString());Console.WriteLine(wide.ToString());}}
  `);
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly)
    : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, 'True\nFalse\nA\n4294967295\n18446744073709551615\n');
  } finally { vm.stop(); }
});
