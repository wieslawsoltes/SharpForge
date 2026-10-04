import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {byrefStressPrograms, byrefStressAssembly, byrefStressSource} from './support/byref-stress-programs.js';
import {stressOptions, sha256, MissingByrefOwnerVM, executeByrefStress, stressReport} from './support/byref-stress-runner.js';

test('gcStress rejects unknown modes and remains disabled by default', () => {
  const compiled = compileToIL('class Program { static void Main() { int value = 1 + 2; } }');
  assert.equal(compiled.success, true);
  for (const Constructor of [VirtualMachine, CilVirtualMachine]) {
    const input = Constructor === VirtualMachine ? compiled.image : compiled.assembly;
    for (const gcStress of [true, 'allocation', 1, null]) {
      assert.throws(() => new Constructor(input, {gcStress}), {code: 'GC_STRESS_MODE'});
    }
    for (const options of [{}, {gcStress: false}]) {
      const vm = new Constructor(input, options);
      try {
        const before = vm.heap.stats.collections;
        assert.equal(vm.run().state, 'terminated');
        assert.equal(vm.heap.stats.collections, before);
      } finally { vm.stop(); }
    }
  }
});

test('byref stress boundary and negative controls cover each owner and root-provider mode', () => {
  for (const specimen of byrefStressPrograms(3)) {
    const assembly = byrefStressAssembly(specimen);
    for (const preciseRoots of [false, true]) {
      const result = executeByrefStress(new CilVirtualMachine(assembly, {...stressOptions, preciseRoots}), specimen);
      for (const container of ['stack', 'arguments', 'locals']) {
        assert(result.coverage.sole[container] > 0, `${specimen.kind} must solely own its object in ${container}`);
      }
    }
    executeByrefStress(new MissingByrefOwnerVM(assembly, {...stressOptions, preciseRoots: false}), specimen, {negative: true});
  }
});

test('gcStress observes each admitted source and CIL array continuation work unit', () => {
  const compiled = compileToIL(`using System; class Program { static void Main() {
    int[] values = new int[128]; for (int index = 0; index < values.Length; index++) values[index] = 128 - index;
    Array.Sort(values); Array.Reverse(values); Console.WriteLine(values[0]);
  } }`);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image, stressOptions), new CilVirtualMachine(compiled.assembly, stressOptions)]) {
    try {
      const before = vm.heap.stats.collections;
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), '128\n');
      assert.equal(vm.heap.stats.collections - before, vm.instructions);
    } finally { vm.stop(); }
  }
});

test('instruction collection respects observer pauses, manual CIL steps and stopped machines', () => {
  const compiled = compileToIL('class Program { static void Main() { int value = 3; Console.WriteLine(value); } }');
  assert.equal(compiled.success, true);
  for (const vm of [new VirtualMachine(compiled.image, stressOptions), new CilVirtualMachine(compiled.assembly, stressOptions)]) {
    try {
      const before = vm.heap.stats.collections;
      if (vm.inspector) {
        vm.runSlice({onInstruction: () => true});
        assert.equal(vm.heap.stats.collections, before, 'a debugger pause does not execute an instruction');
        vm.step();
        assert.equal(vm.heap.stats.collections, before + 1, 'manual CIL step uses the same stress boundary');
      } else {
        vm.runSlice({onSequence: () => true});
        assert.equal(vm.heap.stats.collections - before, vm.instructions, 'paused SEQ does not collect');
      }
      vm.stop();
      const stopped = vm.heap.stats.collections;
      vm.runSlice();
      assert.equal(vm.heap.stats.collections, stopped, 'stopped machines do not collect or advance');
    } finally { vm.stop(); }
  }
});

test('1,000 seeded distinct guest programs retain nested byref writes under instruction GC', {timeout: 180000}, context => {
  const specimens = byrefStressPrograms();
  const cases = specimens.map(specimen => {
    const assembly = byrefStressAssembly(specimen);
    const options = {...stressOptions, nativeIntBits: specimen.ordinal % 2 ? 64 : 32, preciseRoots: specimen.ordinal % 4 < 2};
    const result = executeByrefStress(new CilVirtualMachine(assembly, options), specimen);
    return {ordinal: specimen.ordinal, kind: specimen.kind, depth: specimen.levels.length, sha256: sha256(assembly), ...result};
  });
  const counterparts = [];
  for (const specimen of specimens.filter(item => item.kind !== 'box').slice(0, 32)) {
    const source = byrefStressSource(specimen);
    const compiled = compileToIL(source);
    assert.equal(compiled.success, true, `specimen ${specimen.ordinal}: ${JSON.stringify(compiled.diagnostics)}`);
    for (const [engine, vm] of [
      ['source', new VirtualMachine(compiled.image, stressOptions)],
      ['reloaded-source', new VirtualMachine(loadAssembly(compiled.assembly), stressOptions)],
      ['compiled-cil', new CilVirtualMachine(compiled.assembly, stressOptions)]
    ]) {
      const result = executeByrefStress(vm, specimen);
      counterparts.push({ordinal: specimen.ordinal, kind: specimen.kind, engine, sourceSHA256: sha256(source), ...result});
    }
  }
  const report = stressReport(specimens, cases, counterparts);
  assert.equal(report.count, 1000);
  assert.equal(report.uniqueAssemblies, 1000, 'different specimen identifiers alone do not count as distinct guest code');
  assert.equal(report.collections, report.instructions);
  assert.deepEqual(report.depths, [1, 2, 3, 4, 5]);
  assert.deepEqual(report.ownerCounts, {field: 334, array: 333, box: 333});
  assert.equal(counterparts.length, 96);
  context.diagnostic(JSON.stringify({...report, cases: undefined, sourceCounterparts: {count: counterparts.length,
    engines: ['source', 'reloaded-source', 'compiled-cil']}}));
});

test('stress generator bounds and seed are explicit and deterministic', () => {
  assert.deepEqual(byrefStressPrograms(12), byrefStressPrograms(12));
  assert.notDeepEqual(byrefStressPrograms(12), byrefStressPrograms(12, 1));
  for (const count of [0, 1001, 1.5, NaN]) assert.throws(() => byrefStressPrograms(count), RangeError);
  for (const seed of [0, -1, 0x100000000, 1.5]) assert.throws(() => byrefStressPrograms(1, seed), RangeError);
  assert.throws(() => byrefStressSource(byrefStressPrograms(3)[2]), /direct CIL unbox/);
});
