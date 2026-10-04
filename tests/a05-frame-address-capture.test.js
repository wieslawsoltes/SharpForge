import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {createManagedAddress} from '../packages/runtime/src/execution/managed-address.js';
import {managedFixture} from './managed-fixtures.js';

function fixture() {
  return managedFixture({methods: [
    {name: 'Main', body: writer => writer.op('ldnull').op('call', 0x06000002).op('ret')},
    {name: 'Parent', parameters: ['object'], locals: ['object'], body: writer => writer
      .op('ldarg.0').op('pop').op('ldloc.0').op('pop').op('nop').op('call', 0x06000003).op('ret')},
    {name: 'Child', locals: ['object'], body: writer => writer.op('nop').op('ret')},
  ]});
}

for (const kind of ['arg', 'local']) {
  test(`an explicit parent ${kind} address captures its owner while another frame executes`, () => {
    const vm = new CilVirtualMachine(fixture(), {preciseRootLiveness: true});
    try {
      vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
      const parent = vm.top, value = vm.heap.object('object', []);
      const field = kind === 'arg' ? 'args' : 'locals';
      parent[field][0] = value;
      vm.runSlice({instructionBudget: 6, timeBudgetMs: 1000});
      const child = vm.top;
      assert.notEqual(child, parent);
      const address = createManagedAddress(vm, kind, 0, undefined, {frameId: parent.id});
      assert(parent.rootCaptures[field].has(0));
      assert.equal(child.rootCaptures, null, 'the pooled child retains its canonical uncaptured state');
      vm.heap.collect();
      assert.equal(vm.dereference(address), value);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.throws(() => vm.dereference(address), /outlived its frame/);
      assert.throws(() => createManagedAddress(vm, kind, 0, undefined, {frameId: address.frameId}), /outlived its frame/);
    } finally { vm.stop(); }
  });
}
