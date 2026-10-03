import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {inlineCacheStatistics, resolveVirtualCall} from '../packages/runtime/src/execution/inline-cache.js';
import {cachedMethod} from '../packages/runtime/src/execution/token-cache.js';
import {instantiatedMethod} from '../packages/runtime/src/execution/generic-calls.js';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';

function site(vm) {
  const token = [...vm.inspector.methods.values()].find(method => method.name === 'Invoke').token;
  const method = instantiatedMethod(vm, token);
  const instruction = method.instructions.find(item => item.name === 'callvirt');
  const frame = {method, genericIdentity: null, methodArguments: []};
  return {method, instruction, frame, descriptor: cachedMethod(vm, instruction.operand, frame)};
}

for (const interfaceCall of [false, true]) {
  for (const sequence of [[0, 0, 0, 0], [0, 1, 2, 0, 1, 2], [0, 1, 2, 3, 4, 5, 0]]) {
    test(`T07 ${interfaceCall ? 'interface' : 'virtual'} bounded cache preserves receiver sequence ${sequence}`, () => {
      const vm = new CilVirtualMachine(inlineCacheFixture(sequence, {interfaceCall}));
      const target = site(vm), result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.returnValue, sequence.reduce((sum, value) => sum + value + 1, 0));
      const stats = inlineCacheStatistics(vm, target.method, target.instruction.offset);
      if (new Set(sequence).size > 4) {
        assert.equal(stats.megamorphic, true);
        assert.equal(stats.entries, 0);
      } else {
        assert.equal(stats.misses, new Set(sequence).size);
        assert.equal(stats.hits, sequence.length - stats.misses);
      }
    });
  }
}

test('T07 warm virtual cache validates receiver null, lifetime and VM ownership', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture()), target = site(vm);
  const receiver = vm.heap.object('Receiver0', []);
  const resolve = value => resolveVirtualCall(vm, target.frame, target.instruction, target.descriptor, value);
  const first = resolve(receiver);
  assert.equal(resolve(receiver), first);
  assert.throws(() => resolve(null), {name: 'NullReferenceException'});
  const foreign = new CilVirtualMachine(inlineCacheFixture()).heap.object('Receiver0', []);
  assert.throws(() => resolve(foreign), {name: 'InvalidReferenceException'});
  vm.heap.collect();
  assert.throws(() => resolve(receiver), {name: 'InvalidReferenceException'});
});

test('T07 code invalidation drops call-site targets while the same metadata token can acquire a new body', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture());
  const before = site(vm), receiver = vm.heap.object('Receiver0', []);
  resolveVirtualCall(vm, before.frame, before.instruction, before.descriptor, receiver);
  assert.equal(inlineCacheStatistics(vm, before.method, before.instruction.offset).entries, 1);
  invalidateExecutionCode(vm, 'edit');
  assert.equal(inlineCacheStatistics(vm, before.method, before.instruction.offset).entries, 0);
  vm.inspector = new AssemblyInspector(inlineCacheFixture([0], {delta: 10}));
  const next = site(vm);
  assert.notEqual(next.method, before.method);
  vm.stop();
  vm.call(vm.report.entryPoint, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 11);
});

test('T07 disabling inline caches retains dispatch behavior without retaining call-site entries', () => {
  const vm = new CilVirtualMachine(inlineCacheFixture([0, 1, 0, 2]), {inlineCaches: false});
  const target = site(vm), result = vm.run();
  assert.equal(result.returnValue, 7);
  assert.deepEqual(inlineCacheStatistics(vm, target.method, target.instruction.offset),
    {entries: 0, megamorphic: false, hits: 0, misses: 0});
});
