import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {byrefStressPrograms, byrefStressSource} from './support/byref-stress-programs.js';
import {executeByrefStress, stressOptions} from './support/byref-stress-runner.js';

function run(source, expected) {
  const compiled = compileToIL('using System; ' + source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const [engine, vm] of [
    ['source', new VirtualMachine(compiled.image, stressOptions)],
    ['reloaded-source', new VirtualMachine(loadAssembly(compiled.assembly), stressOptions)],
    ['compiled-cil', new CilVirtualMachine(compiled.assembly, stressOptions)]
  ]) {
    try {
      const before = vm.heap.stats.collections;
      const result = vm.run();
      assert.equal(result.state, 'terminated', engine + ': ' + result.fault?.message);
      assert.equal(result.output, expected, engine);
      assert.equal(vm.heap.stats.collections - before, vm.instructions);
    } finally { vm.stop(); }
  }
}

test('field addresses through ref class parameters bind the referenced object, including after reassignment', () => {
  run(`class Node { public int Value; }
    class Program {
      static ref int Field(ref Node node) { return ref node.Value; }
      static void Main() {
        Node node = new Node(); ref int original = ref Field(ref node);
        node = new Node(); node.Value = 99; original = 7;
        Console.WriteLine(original); Console.WriteLine(node.Value);
      }
    }`, '7\n99\n');
});

test('readonly reference slots allow object-field mutation and null receivers keep managed null faults', () => {
  run(`class Node { public int Value; }
    class Program {
      static void Set(in Node node) { node.Value = 23; }
      static void Main() {
        Node node = new Node(); Set(in node); Console.WriteLine(node.Value);
        node = null;
        try { Set(in node); } catch (NullReferenceException) { Console.WriteLine("null"); }
      }
    }`, '23\nnull\n');
});

test('nested struct references survive actual instruction GC on the source and reloaded routes', () => {
  for (const specimen of byrefStressPrograms(2)) {
    const compiled = compileToIL(byrefStressSource(specimen));
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    for (const vm of [new VirtualMachine(compiled.image, stressOptions),
      new VirtualMachine(loadAssembly(compiled.assembly), stressOptions), new CilVirtualMachine(compiled.assembly, stressOptions)]) {
      executeByrefStress(vm, specimen);
    }
  }
});
