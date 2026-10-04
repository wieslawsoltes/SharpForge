import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilDebugSession, instructionReference} from '@sharpforge/debugger';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {CilTypeSystem} from '../packages/runtime/src/execution/type-system.js';
import {cachedMetadataToken} from '../packages/runtime/src/execution/token-cache.js';
import {inlineCacheStatistics, resolveVirtualTarget} from '../packages/runtime/src/execution/inline-cache.js';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';

function site(vm) {
  const token = [...vm.inspector.methods.values()].find(method => method.name === 'Invoke').token;
  const method = vm.inspector.getMethod(token);
  const instruction = method.instructions.find(item => item.name === 'callvirt');
  return {method, instruction, frame: {method}, descriptor: cachedMetadataToken(vm, instruction.operand)};
}

class CountingTypeSystem extends CilTypeSystem {
  virtualTarget(...args) {
    this.resolutions = (this.resolutions ?? 0) + 1;
    return super.virtualTarget(...args);
  }
}

for (const interfaceCall of [false, true]) {
  for (const sequence of [[0, 0, 0, 0], [0, 1, 2, 0, 1, 2], [0, 1, 2, 3, 4, 5, 0]]) {
    test(`${interfaceCall ? 'interface' : 'virtual'} cache preserves receivers ${sequence}`, () => {
      const results = [];
      for (const inlineCaches of [false, true]) {
        const vm = new CilVirtualMachine(inlineCacheFixture(sequence, {interfaceCall}), {inlineCaches});
        vm._typeSystem = new CountingTypeSystem(vm);
        const target = site(vm);
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.returnValue, sequence.reduce((sum, index) => sum + index + 1, 0));
        const stats = inlineCacheStatistics(vm, target.method, target.instruction.offset);
        assert(Object.isFrozen(stats));
        if (!inlineCaches) {
          assert.equal(stats.entries, 0);
          assert.equal(vm.typeSystem.resolutions, sequence.length);
        } else if (new Set(sequence).size > 4) {
          assert.equal(stats.megamorphic, true);
          assert.equal(stats.entries, 0);
          assert.equal(vm.typeSystem.resolutions, sequence.length);
        } else {
          assert.equal(stats.entries, new Set(sequence).size);
          assert.equal(stats.misses, new Set(sequence).size);
          assert.equal(stats.hits, sequence.length - stats.misses);
          assert.equal(vm.typeSystem.resolutions, stats.misses);
        }
        results.push([result.returnValue, result.stats.instructions]);
      }
      assert.deepEqual(results[0], results[1]);
    });
  }
}

for (const limit of [1, 16]) {
  test(`cache capacity ${limit} stops retaining entries after the next receiver type`, () => {
    const sequence = Array.from({length: limit + 1}, (_, index) => index);
    sequence.push(0);
    const vm = new CilVirtualMachine(inlineCacheFixture(sequence), {inlineCacheSize: limit});
    const target = site(vm);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, sequence.reduce((sum, index) => sum + index + 1, 0));
    assert.deepEqual(inlineCacheStatistics(vm, target.method, target.instruction.offset),
      {entries: 0, megamorphic: true, hits: 0, misses: sequence.length});
  });
}

test('invalid capacities fail at the first virtual site without admitting an entry', () => {
  for (const inlineCacheSize of [0, 17, 1.5, NaN, '4']) {
    const vm = new CilVirtualMachine(inlineCacheFixture(), {inlineCacheSize});
    const target = site(vm);
    const receiver = vm.heap.object('Receiver0', []);
    assert.throws(() => resolveVirtualTarget(vm, target.frame, target.instruction, target.descriptor, receiver), RangeError);
    assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  }
});

test('warm hits validate null, unrelated and collected receivers and do not root their objects', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture());
  const target = site(vm);
  const receiver = vm.heap.object('Receiver0', []);
  const resolve = value => resolveVirtualTarget(vm, target.frame, target.instruction, target.descriptor, value);
  const first = resolve(receiver);
  assert.equal(resolve(receiver), first);
  assert.throws(() => resolve(null), {name: 'NullReferenceException'});
  const unrelated = vm.heap.object('Program', []);
  assert.throws(() => resolve(unrelated), /incompatible/);
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 1);
  vm.heap.collect();
  assert.throws(() => resolve(receiver), {name: 'InvalidReferenceException'});
});

test('restored execution rebuilds call sites and preserves one-instruction budgets and results', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture([0, 1, 0, 1]));
  const target = site(vm);
  while (inlineCacheStatistics(vm, target.method, target.instruction.offset).hits === 0) {
    assert(['ready', 'running'].includes(vm.state), vm.fault?.message);
    const before = vm.instructions;
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.equal(vm.instructions - before, 1);
  }
  const snapshot = vm.snapshot();
  const stats = inlineCacheStatistics(vm, target.method, target.instruction.offset);
  assert.throws(() => vm.restore({...snapshot, schemaVersion: 999}), /schema version/);
  assert.deepEqual(inlineCacheStatistics(vm, target.method, target.instruction.offset), stats);
  const expected = vm.run();
  vm.restore(snapshot);
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  vm.heap.collect();
  const replay = vm.run();
  assert.equal(replay.state, 'terminated', replay.fault?.message);
  assert.equal(replay.returnValue, expected.returnValue);
  assert.equal(replay.stats.instructions, expected.stats.instructions);
});

test('body replacement, explicit invalidation and stop discard sites; VMs sharing metadata stay independent', () => {
  const inspector = new AssemblyInspector(inlineCacheFixture());
  const vm = new CilVirtualMachine(inspector);
  const independent = new CilVirtualMachine(inspector);
  const target = site(vm);
  const receiver = vm.heap.object('Receiver0', []);
  const resolve = () => resolveVirtualTarget(vm, target.frame, target.instruction, target.descriptor, receiver);
  resolve();
  assert.equal(inlineCacheStatistics(independent, target.method, target.instruction.offset).entries, 0);
  target.method.instructions = [...target.method.instructions];
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  resolve();
  vm._typeSystem = new CilTypeSystem(vm);
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  resolve();
  invalidateExecutionCode(vm, 'edit');
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  resolve();
  vm.stop();
  assert.equal(inlineCacheStatistics(vm, target.method, target.instruction.offset).entries, 0);
  vm.inspector = new AssemblyInspector(inlineCacheFixture([0], {delta: 10}));
  vm.call(vm.report.entryPoint, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 11);
});

test('debugger Hot Reload invalidates warm targets only after committing new metadata', () => {
  const before = inlineCacheFixture([0, 0]);
  const after = inlineCacheFixture([0, 0], {delta: 10});
  const session = new CilDebugSession(before);
  const main = session.vm.top.method;
  const secondObject = main.instructions.filter(instruction => instruction.name === 'newobj')[1];
  const [breakpoint] = session.setInstructionBreakpoints([
    {instructionReference: instructionReference(main.token, secondObject.offset)}
  ]);
  assert(breakpoint.verified);
  session.start(false);
  session.runUntilStop();
  assert.equal(session.vm.state, 'paused');
  const target = site(session.vm);
  const warmed = inlineCacheStatistics(session.vm, target.method, target.instruction.offset);
  assert.equal(warmed.entries, 1);
  assert.throws(() => session.applyChanges(after, {expectedVersion: -1}), /version/i);
  assert.deepEqual(inlineCacheStatistics(session.vm, target.method, target.instruction.offset), warmed);
  session.applyChanges(after);
  assert.equal(inlineCacheStatistics(session.vm, target.method, target.instruction.offset).entries, 0);
  session.resume();
  session.runUntilStop();
  assert.equal(session.vm.state, 'terminated', session.vm.fault?.message);
  assert.equal(session.vm.returnValue, 12);
});
