import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {address, pointerType} from '../packages/runtime/src/execution/control-pointers.js';
import {SyncPrimitives} from '../packages/runtime/src/execution/sync-primitives.js';

const compiled = compileToIL('class P {static void Main(){bool flag=false;int value=0;Console.WriteLine(flag);Console.WriteLine(value);}}');
assert(compiled.success, JSON.stringify(compiled.diagnostics));

for (const engine of ['source', 'cil']) test(`${engine}: Monitor lockTaken uses the exact owned Boolean location type`, () => {
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  const types = () => engine === 'source' ? vm.image.methods[vm.top?.methodId]?.locals.map(local => local.type)
    : vm.top?.method.locals;
  const indexOf = name => types()?.findIndex(type => vm.heap.methodTables.get(type).name === name) ?? -1;
  for (let count = 0; count < 100 && indexOf('System.Boolean') < 0 && ['ready', 'running'].includes(vm.state); count++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  }
  const booleanIndex = indexOf('System.Boolean'), integerIndex = indexOf('System.Int32');
  assert(booleanIndex >= 0 && integerIndex >= 0, 'Observe actual declared Boolean and Int32 locals');
  const flag = address(vm, 'local', booleanIndex), integer = address(vm, 'local', integerIndex);
  assert.equal(pointerType(vm, flag).name, 'System.Boolean');
  assert.equal(pointerType(vm, integer).name, 'System.Int32');
  vm.dereference(flag, true, engine === 'cil' ? 0 : false);
  const sync = new SyncPrimitives(vm);
  assert.doesNotThrow(() => sync.lockFlag(flag));
  assert.throws(() => sync.lockFlag(integer), /lockTaken must address a Boolean/);
  assert.throws(() => sync.lockFlag(address(vm, 'local', booleanIndex, null, {readonly: true})), /readonly/);
  vm.dereference(flag, true, engine === 'cil' ? 1 : true);
  assert.throws(() => sync.lockFlag(flag), {name: 'ArgumentException'});
  vm.stop();
});
