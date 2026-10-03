import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {methodOffsets} from '../packages/runtime/src/execution/method-offsets.js';

test('CIL frames reuse one offset map per method body', () => {
  const bytes = managedFixture();
  const vm = new CilVirtualMachine(bytes), first = vm.top, method = first.method;
  // No per-call instruction walk is possible after the initial plan was built.
  method.instructions.map = () => { throw new Error('Decoded a method again'); };
  vm.call(method.token, []);
  assert.equal(vm.top.offsets, first.offsets);
  assert.notEqual(vm.top.stack, first.stack);
  assert.notEqual(vm.top.locals, first.locals);
  assert.equal(vm.run().returnValue, 42);
});
test('offset plans change when a method body is replaced and do not collide across methods', () => {
  const a = {instructions: [{offset: 0}, {offset: 3}]}, b = {instructions: [{offset: 0}, {offset: 3}]};
  const offsets = methodOffsets(a);
  assert.equal(methodOffsets(a), offsets);
  assert.notEqual(methodOffsets(b), offsets);
  a.instructions = [{offset: 0}, {offset: 5}];
  assert.notEqual(methodOffsets(a), offsets);
  assert.equal(methodOffsets(a).get(5), 1);
  assert.equal(methodOffsets(a).has(3), false);
});
