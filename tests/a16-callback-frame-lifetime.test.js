import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../packages/runtime/src/ui/callbacks.js';
import {retainCallbackFrames} from '../packages/runtime/src/execution/callback-frames.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', body: writer => writer.op('ret')},
    {name: 'Outer', result: 'object', locals: ['object'], body(writer, context) {
      writer.op('ldc.i4.1').op('newarr', context.resolve('System.Object')).op('stloc.0');
      writer.op('nop').op('ldloc.0').op('ret');
    }},
    {name: 'Inner', result: 'object', parameters: ['object&'], body(writer, context) {
      writer.op('ldarg.0').op('ldc.i4.1').op('newarr', context.resolve('System.Object')).op('stind.ref');
      writer.op('call', context.member('System.GC', 'Collect', 'void', []));
      writer.op('ldarg.0').op('ldind.ref').op('ret');
    }}
  ]}]);
}

test('nested CIL callbacks preserve outer local addresses and newly stored references through precise collection', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    assert.equal(vm.run().state, 'terminated');
    const token = name => [...vm.inspector.methods.values()].find(method => method.name === name).token;
    const outer = token('Outer'), inner = token('Inner'), runSlice = vm.runSlice.bind(vm);
    let address, initial, replacement, invoked = false;
    vm.runSlice = options => runSlice({...options, onInstruction(instruction, frame) {
      if (invoked || frame.method.token !== outer || instruction.name !== 'nop') return;
      invoked = true;
      address = vm.address('local', 0);
      initial = vm.dereference(address);
      replacement = invokeManagedMethod(vm.platform, inner, null, [address]);
      assert.equal(vm.heap.get(replacement).kind, 'array');
      assert.deepEqual(vm.dereference(address), replacement);
      assert.notDeepEqual(replacement, initial);
    }});
    const result = invokeManagedMethod(vm.platform, outer, null, []);
    assert.equal(invoked, true);
    assert.deepEqual(result, replacement);
    assert.equal(vm.heap.get(result).kind, 'array');
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.throws(() => vm.dereference(address), /outlived/);
    vm.heap.withRoots([result], () => vm.heap.collect());
    assert.throws(() => vm.heap.get(initial), /stale|generation|released|Invalid|collected/i);
  } finally { vm.stop(); }
});

test('nested native callback frame ownership is bounded and cleanup is idempotent', () => {
  const scheduler = {}, releases = [];
  for (let depth = 0; depth < 128; depth++) releases.push(retainCallbackFrames(scheduler, {frames: [], stack: []}));
  assert.throws(() => retainCallbackFrames(scheduler, {frames: []}), {name: 'ExecutionLimitException'});
  for (const release of releases.reverse()) { release(); release(); }
  assert.equal(scheduler.callbackScopes.length, 0);
});
