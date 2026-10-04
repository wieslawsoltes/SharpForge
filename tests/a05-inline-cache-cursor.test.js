import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {inlineCacheStatistics, resolveVirtualTarget} from '../packages/runtime/src/execution/inline-cache.js';
import {cachedMetadataToken} from '../packages/runtime/src/execution/token-cache.js';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';

function setup() {
  const vm = new CilVirtualMachine(inlineCacheFixture());
  const declaration = [...vm.inspector.methods.values()].find(item => item.name === 'Invoke');
  const method = vm.inspector.getMethod(declaration.token);
  const instruction = method.instructions.find(item => item.name === 'callvirt');
  const descriptor = cachedMetadataToken(vm, instruction.operand);
  return {vm, method, instruction, descriptor, frame: {method}};
}

test('alternating methods and offsets retain independent receiver dispatch and counters', () => {
  const {vm, method, instruction, descriptor, frame} = setup();
  try {
    const secondMethod = {...method, instructions: [...method.instructions]};
    const secondSite = {...instruction, offset: instruction.offset + 100};
    const first = vm.heap.object('Receiver0', []), second = vm.heap.object('Receiver1', []);
    const resolve = (caller, site, receiver) => resolveVirtualTarget(vm, caller, site, descriptor, receiver);
    const firstTarget = resolve(frame, instruction, first);
    const secondTarget = resolve({method: secondMethod}, instruction, second);
    assert.notEqual(firstTarget, secondTarget);
    for (let index = 0; index < 4; index++) {
      assert.equal(resolve(frame, instruction, first), firstTarget);
      assert.equal(resolve(frame, secondSite, second), secondTarget);
      assert.equal(resolve({method: secondMethod}, instruction, second), secondTarget);
    }
    assert.deepEqual(inlineCacheStatistics(vm, method, instruction.offset),
      {entries: 1, megamorphic: false, hits: 4, misses: 1});
    assert.deepEqual(inlineCacheStatistics(vm, method, secondSite.offset),
      {entries: 1, megamorphic: false, hits: 3, misses: 1});
    assert.deepEqual(inlineCacheStatistics(vm, secondMethod, instruction.offset),
      {entries: 1, megamorphic: false, hits: 4, misses: 1});
    vm.heap.collect();
    assert.throws(() => resolve({method: secondMethod}, instruction, second), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('a warm site still keys dispatch by operand, declaration and closed owner', () => {
  const {vm, method, instruction, descriptor, frame} = setup();
  const original = vm.typeSystem.virtualTarget;
  let resolutions = 0;
  vm.typeSystem.virtualTarget = function(...args) {
    resolutions++;
    return original.apply(this, args);
  };
  try {
    const receiver = vm.heap.object('Receiver0', []);
    const invoke = (site, declaration) => resolveVirtualTarget(vm, frame, site, declaration, receiver);
    const target = invoke(instruction, descriptor);
    assert.equal(invoke(instruction, descriptor), target);
    assert.equal(resolutions, 1);
    const otherOperand = {...instruction, operand: target};
    assert.equal(invoke(otherOperand, descriptor), target);
    assert.equal(resolutions, 2);
    const implementation = {...descriptor, resolvedToken: target};
    assert.equal(invoke(otherOperand, implementation), target);
    assert.equal(resolutions, 3);
    const closed = {...implementation, ownerInstance: 'Receiver0'};
    assert.equal(invoke(otherOperand, closed), target);
    assert.equal(resolutions, 4);
    assert.equal(invoke(otherOperand, closed), target);
    assert.equal(resolutions, 4);
    assert.deepEqual(inlineCacheStatistics(vm, method, instruction.offset),
      {entries: 1, megamorphic: false, hits: 1, misses: 1});
  } finally { vm.stop(); }
});

test('live capacity changes reset warm sites and still validate invalid capacities', () => {
  const {vm, method, instruction, descriptor, frame} = setup();
  try {
    const receivers = [vm.heap.object('Receiver0', []), vm.heap.object('Receiver1', [])];
    const resolve = index => resolveVirtualTarget(vm, frame, instruction, descriptor, receivers[index]);
    resolve(0);
    resolve(0);
    vm.options.inlineCacheSize = 1;
    resolve(0);
    resolve(1);
    assert.deepEqual(inlineCacheStatistics(vm, method, instruction.offset),
      {entries: 0, megamorphic: true, hits: 0, misses: 2});
    vm.options.inlineCacheSize = 0;
    assert.throws(() => resolve(0), /Inline cache size must be 1–16/);
    vm.options.inlineCacheSize = 16;
    resolve(0);
    resolve(1);
    resolve(0);
    assert.deepEqual(inlineCacheStatistics(vm, method, instruction.offset),
      {entries: 2, megamorphic: false, hits: 1, misses: 2});
  } finally { vm.stop(); }
});

for (const transition of ['epoch', 'instructions', 'capacity']) {
  test(`prepared calls recheck ${transition} changes made by the initialization hook`, () => {
    const {vm, method, instruction} = setup(), ensureInitialized = vm.ensureInitialized;
    let calls = 0;
    vm.ensureInitialized = function(...args) {
      if (this.top?.method === method && method.instructions[this.top.pc - 1]?.name === 'callvirt') {
        if (++calls === 2) {
          if (transition === 'epoch') invalidateExecutionCode(this, 'initialization-hook');
          if (transition === 'instructions') method.instructions = [...method.instructions];
          if (transition === 'capacity') this.options.inlineCacheSize = 1;
        }
      }
      return ensureInitialized.apply(this, args);
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 4);
      assert.equal(calls, 4);
      assert.deepEqual(inlineCacheStatistics(vm, method, instruction.offset),
        {entries: 1, megamorphic: false, hits: 2, misses: 1});
    } finally { vm.stop(); }
  });
}
