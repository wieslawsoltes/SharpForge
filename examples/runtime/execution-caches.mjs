// node examples/runtime/execution-caches.mjs
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {
  VirtualMachine, CilVirtualMachine, prepareExecution, invalidateExecutionCode, executionCodeStatistics
} from '@sharpforge/runtime';

const source = `using System;
interface Counter { int Value(); }
class Twice : Counter { public int Value() { return 2; } }
class Program {
  static int Read(Counter counter) { return counter.Value(); }
  static void Main() {
    Counter counter = new Twice(); int sum = 0;
    for (int index = 0; index < 8; index++) sum += Read(counter);
    Console.WriteLine(sum);
  }
}`;

/** Preparation and invalidation derive metadata; neither advances the managed program. */
export function executeCacheExample() {
  const compiled = compileToIL(source, {pipeline: 'bound'});
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  const routes = [
    ['source', () => new VirtualMachine(compiled.image)],
    ['reloaded source', () => new VirtualMachine(loadAssembly(compiled.assembly))],
    ['direct CIL', () => new CilVirtualMachine(compiled.assembly)]
  ];
  return routes.map(([engine, create]) => {
    const vm = create();
    try {
      const snapshot = vm.snapshot();
      const first = prepareExecution(vm);
      assert.equal(first.status, 'prepared');
      assert.equal(vm.instructions, 0);
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      const before = vm.instructions;
      const epoch = invalidateExecutionCode(vm, 'example-reprepare');
      const rebuilt = prepareExecution(vm);
      assert.equal(rebuilt.statistics.epoch, epoch);
      assert.ok(epoch > first.statistics.epoch);
      assert.equal(vm.instructions, before);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '16\n');
      const completed = executionCodeStatistics(vm);
      vm.restore(snapshot);
      const restored = prepareExecution(vm);
      assert.ok(restored.statistics.epoch > completed.epoch);
      const replay = vm.run();
      assert.equal(replay.state, 'terminated', replay.fault?.message);
      assert.equal(replay.output, result.output);
      assert.equal(replay.stats.instructions, result.stats.instructions);
      return {engine, output: result.output, prepared: first.status,
        initialEpoch: first.statistics.epoch, invalidatedEpoch: epoch, restoredEpoch: restored.statistics.epoch};
    } finally {
      vm.stop();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const observation of executeCacheExample()) console.log(JSON.stringify(observation));
}
