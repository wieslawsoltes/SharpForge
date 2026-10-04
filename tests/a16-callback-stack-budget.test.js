import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine, framePoolStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../packages/runtime/src/ui/callbacks.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const names = ['Main', 'Outer', 'Inner', 'Probe', 'Spin'];
const overflow = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};

function sourceImage() {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [null], types: [], statics: [],
    sequencePoints: [], sources: [], methods: names.map((name, id) => ({
      id, name, qualifiedName: name, owner: null, isStatic: true, returnType: 'void',
      parameters: [], handlers: [], locals: [], code: Int32Array.from(name === 'Spin'
        ? [Op.JUMP, 0, 0] : [Op.NOP, 0, 0, Op.CONST, 0, 0, Op.RET, 0, 0])
    }))};
}

function cilImage() {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 1, body(writer, context) {
      // Both branches are verified; the infinite callback is never entered by Main.
      writer.op('ldc.i4.0').op('brfalse.s', 'done').op('call', context.methods.get('Program.Spin')).mark('done');
      for (const name of ['Outer', 'Inner', 'Probe']) writer.op('call', context.methods.get('Program.' + name));
      writer.op('ret');
    }},
    ...names.slice(1).map(name => ({name, maxStack: 0, body: writer => name === 'Spin'
      ? writer.mark('loop').op('br.s', 'loop') : writer.op('nop').op('ret')}))
  ]}]);
}

function create(engine, maxStackBytes) {
  const vm = engine === 'source' ? new VirtualMachine(sourceImage(), {maxStackBytes})
    : new CilVirtualMachine(cilImage(), {maxStackBytes});
  const id = name => engine === 'source' ? names.indexOf(name)
    : [...vm.inspector.methods.values()].find(method => method.name === name).token;
  const activeName = () => engine === 'source' ? names[vm.top.methodId] : vm.top.method.name;
  return {vm, id, activeName};
}

test('A16 CIL: admitting an unreachable callback preserves exact stack proofs for callback and caller', () => {
  const vm = new CilVirtualMachine(genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 0, body: writer => writer.op('ret')},
    {name: 'Probe', maxStack: 1, result: 'int', body: writer => writer.integer(42).op('ret')}
  ]}]), {maxStackBytes: 40});
  try {
    const probe = [...vm.inspector.methods.values()].find(method => method.name === 'Probe').token;
    assert.equal(vm.report.methods.includes(probe), false);
    const outer = vm.top;
    assert.equal(invokeManagedMethod(vm.platform, probe, null, []), 42);
    assert.equal(vm.report.methods.includes(probe), true);
    assert.equal(vm.top, outer);
    vm.options.maxStackBytes = 39;
    assert.throws(() => invokeManagedMethod(vm.platform, probe, null, []), overflow);
    vm.options.maxStackBytes = 40;
    assert.equal(invokeManagedMethod(vm.platform, probe, null, []), 42);
    assert.equal(vm.run().state, 'terminated');
  } finally { vm.stop(); }
});

for (const engine of ['source', 'cil']) {
  test(`A16 ${engine}: repeated callback instruction aborts release byte reservations and pooled frames`, () => {
    const {vm, id} = create(engine, 40); // Main=24 bytes, zero-peak Spin=16 bytes.
    const outer = vm.top, frames = vm.frames, state = vm.state, pc = outer.pc;
    const instructionLimit = vm.options.maxInstructions;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        assert.throws(() => invokeManagedMethod(vm.platform, id('Spin'), null, [], {maxInstructions: 3}),
          {name: 'ExecutionLimitException', message: 'Synchronous UI callback instruction budget exceeded'});
        assert.equal(vm.frames, frames);
        assert.equal(vm.top, outer);
        assert.equal(outer.pc, pc);
        assert.equal(vm.state, state);
        assert.equal(vm.options.maxInstructions, instructionLimit);
        assert.equal(vm.scheduler.callbackScopes.length, 0);
      }
      assert.equal(framePoolStatistics(vm).framesAllocated, 2, 'aborted callback storage is reused');
      assert.equal(vm.run().state, 'terminated');
      assert.equal(invokeManagedMethod(vm.platform, id('Probe'), null, []), null);
      assert.equal(vm.heap.pins.length, 0);
    } finally { vm.stop(); }
  });

  test(`A16 ${engine}: paused callbacks release their isolated frame before restoring the caller`, () => {
    const callbackBytes = engine === 'source' ? 24 : 16;
    const {vm, id} = create(engine, 24 + callbackBytes);
    const outer = vm.top, frames = vm.frames, runSlice = vm.runSlice;
    try {
      vm.runSlice = () => { vm.state = 'paused'; return vm.state; };
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.throws(() => invokeManagedMethod(vm.platform, id('Outer'), null, []),
          {name: 'InvalidOperationException', message: 'A synchronous UI callback cannot suspend execution'});
        assert.equal(vm.frames, frames);
        assert.equal(vm.top, outer);
        assert.equal(vm.scheduler.callbackScopes.length, 0);
      }
      vm.runSlice = runSlice;
      assert.equal(vm.run().state, 'terminated');
      assert.equal(invokeManagedMethod(vm.platform, id('Probe'), null, []), null);
    } finally { vm.runSlice = runSlice; vm.stop(); }
  });

  test(`A16 ${engine}: rebuilt byte quotas include nested callback scopes once`, () => {
    const callbackBytes = engine === 'source' ? 24 : 16, exactLimit = 24 + 3 * callbackBytes;
    const {vm, id, activeName} = create(engine, exactLimit);
    const outer = vm.top, runSlice = vm.runSlice;
    let enteredOuter = false, enteredInner = false;
    try {
      vm.runSlice = function(options) {
        if (activeName() === 'Outer' && !enteredOuter) {
          enteredOuter = true;
          invokeManagedMethod(vm.platform, id('Inner'), null, []);
        } else if (activeName() === 'Inner' && !enteredInner) {
          enteredInner = true;
          invalidateExecutionCode(vm, 'callback-quota-rebuild');
          vm.options.maxStackBytes = exactLimit - 1;
          assert.throws(() => invokeManagedMethod(vm.platform, id('Probe'), null, []), overflow);
          assert.equal(activeName(), 'Inner');
          vm.options.maxStackBytes = exactLimit;
          assert.equal(invokeManagedMethod(vm.platform, id('Probe'), null, []), null,
            'Main is shared by a saved context and a callback scope, but charged only once');
        }
        return runSlice.call(this, options);
      };
      invokeManagedMethod(vm.platform, id('Outer'), null, []);
      assert.equal(enteredOuter, true);
      assert.equal(enteredInner, true);
      assert.equal(vm.top, outer);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      vm.runSlice = runSlice;
      assert.equal(vm.run().state, 'terminated');
    } finally { vm.runSlice = runSlice; vm.stop(); }
  });
}
