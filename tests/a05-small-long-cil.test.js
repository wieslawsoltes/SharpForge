import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {floatSlots, SmallLongSlotTag} from '../packages/runtime/src/execution/typed-stack.js';
import {managedFixture} from './managed-fixtures.js';

function arithmetic(name = 'add', left = 1n, right = 2n) {
  return managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2,
    body: writer => writer.op('ldc.i8', left).op('ldc.i8', right).op(name).op('ret')} ]});
}

function loop(referenceLocal = false) {
  const locals = referenceLocal ? ['long', 'long', 'double', 'object'] : ['long', 'long', 'double'];
  return managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2, locals, body(writer) {
    writer.op('ldc.i8', 0n).op('stloc.0').op('ldc.i8', 0n).op('stloc.1').op('ldc.r8', 0).op('stloc.2').mark('loop');
    writer.op('ldloc.0').op('ldloc.1').op('add').op('stloc.0');
    writer.op('ldloc.2').op('ldc.r8', 0.25).op('add').op('stloc.2');
    writer.op('ldloc.1').op('ldc.i8', 1n).op('add').op('stloc.1');
    writer.op('ldloc.1').op('ldc.i8', 100n).op('blt.s', 'loop').op('ldloc.0').op('ret');
  }}]});
}

function beforeReturn(vm) {
  let remaining = 4000;
  while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
    assert(--remaining > 0);
    vm.step();
  }
}

test('small-long counter and accumulator stay exact across private lanes and pool reuse', () => {
  for (const options of [{}, {smallLongs: true}, {smallLongs: true, typedNumericStack: true, specializeNumericHandlers: true}]) {
    const vm = new CilVirtualMachine(loop(), options);
    const stack = vm.top.stack;
    const locals = vm.top.locals;
    if (!options.smallLongs) assert.equal(floatSlots(stack), null);
    beforeReturn(vm);
    if (options.smallLongs) {
      assert.equal(floatSlots(stack).materializations, 0);
      assert.equal(floatSlots(locals).materializations, 0);
      assert.equal(floatSlots(locals).numbers[0], 4950);
      assert.equal(typeof locals[0], 'bigint');
      assert.equal(locals[2].value, 25);
    }
    assert.equal(vm.run().returnValue, 4950n);
    assert.equal(stack.length, 0);
    assert(framePoolStatistics(vm).released > 0);
    if (options.smallLongs) assert.equal(floatSlots(stack).tags.some(Boolean), false);
    vm.call(vm.inspector.pe.entryPoint, []);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 4950n);
    vm.stop();
  }
});

test('unsafe arithmetic falls back with original operands and exact results can return to the lane', () => {
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2, body(writer) {
    writer.op('ldc.i8', maximum).op('ldc.i8', 2n).op('add').op('ldc.i8', 2n).op('sub').op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {smallLongs: true, specializeNumericHandlers: true});
  vm.step();
  vm.step();
  vm.step();
  assert.equal(vm.top.stack[0], 9007199254740993n);
  assert.equal(floatSlots(vm.top.stack).tags[0], 0);
  vm.step();
  vm.step();
  assert.equal(floatSlots(vm.top.stack).tags[0], SmallLongSlotTag);
  assert.equal(vm.run().returnValue, maximum);
});

test('checked, unsigned and unsupported arithmetic retain the exact BigInt path and managed faults', () => {
  const minimum = -(1n << 63n);
  const maximum = (1n << 63n) - 1n;
  for (const [name, left, right] of [
    ['add.ovf', maximum, 1n], ['sub.ovf', minimum, 1n], ['mul.ovf', 9007199254740991n, 2048n],
    ['add.ovf.un', -1n, 1n], ['sub.ovf.un', 0n, 1n], ['mul.ovf.un', -1n, 2n],
    ['add.ovf.un', 17n, 3n], ['sub.ovf', 17n, 20n], ['mul', 123456789n, 987654321n],
    ['div', minimum, -1n], ['rem', minimum, -1n], ['div', 1n, 0n], ['rem', 17n, 3n],
    ['div.un', -1n, 3n], ['rem.un', -1n, 3n], ['and', -1n, 17n], ['xor', -1n, 17n]
  ]) {
    const bytes = arithmetic(name, left, right);
    const reference = new CilVirtualMachine(bytes).run();
    const actual = new CilVirtualMachine(bytes, {smallLongs: true}).run();
    assert.equal(actual.state, reference.state, name);
    assert.equal(actual.returnValue, reference.returnValue, name);
    assert.equal(actual.fault?.name, reference.fault?.name, name);
    assert.equal(actual.fault?.message, reference.fault?.message, name);
  }
});

test('negation and unsigned comparison retain signed stack patterns in private lanes', () => {
  for (const value of [-9007199254740991n, -1n, 0n, 9007199254740991n, -(1n << 63n)]) {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 1,
      body: writer => writer.op('ldc.i8', value).op('neg').op('ret')} ]});
    assert.equal(new CilVirtualMachine(bytes, {smallLongs: true}).run().returnValue, BigInt.asIntN(64, -value));
  }
  for (const name of ['clt', 'cgt.un', 'bge.un.s']) {
    for (const [left, right] of [[-1n, 1n], [-17n, -3n], [9007199254740991n, 9007199254740990n]]) {
      const bytes = managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 2, body(writer) {
        writer.op('ldc.i8', left).op('ldc.i8', right);
        if (name.startsWith('c')) writer.op(name).op('ret');
        else writer.op(name, 'yes').integer(0).op('ret').mark('yes').integer(1).op('ret');
      }}]});
      const reference = new CilVirtualMachine(bytes).run();
      const actual = new CilVirtualMachine(bytes, {smallLongs: true}).run();
      assert.equal(actual.state, 'terminated', actual.fault?.stack);
      assert.equal(actual.returnValue, reference.returnValue, name);
    }
  }
});

test('host writes, descriptors and array replacement retain generic behavior', () => {
  for (const edit of ['array', 'descriptor', 'wrong-width']) {
    const vm = new CilVirtualMachine(arithmetic(), {smallLongs: true});
    vm.step();
    vm.step();
    if (edit === 'array') vm.top.stack = [3n, 4n];
    else if (edit === 'descriptor') Object.defineProperty(vm.top.stack, '0', {value: 3n});
    else vm.top.stack[0] = 3;
    const result = vm.run();
    if (edit === 'wrong-width') assert.equal(result.fault.name, 'InvalidProgramException');
    else assert.equal(result.returnValue, edit === 'array' ? 7n : 5n);
  }
  const vm = new CilVirtualMachine(loop(), {smallLongs: true});
  vm.step();
  vm.step();
  vm.dereference(vm.address('local', 0), true, 7n);
  const writes = [];
  vm.onWrite = write => writes.push(write);
  assert.equal(vm.run().returnValue, 4957n);
  assert(writes.some(write => typeof write.value === 'bigint'));
});

test('option edits invalidate plans independently and unproven methods retain ordinary handlers', () => {
  const vm = new CilVirtualMachine(arithmetic(), {smallLongs: true, specializeNumericHandlers: true});
  const first = getDecodePlan(vm, vm.top.method);
  assert(first.numericHandlerIds.includes('add_small_i8'));
  vm.options.smallLongs = false;
  const second = getDecodePlan(vm, vm.top.method);
  assert.notEqual(second, first);
  assert(second.numericHandlerIds.includes('add_i8'));
  vm.options.specializeNumericHandlers = false;
  assert.equal(getDecodePlan(vm, vm.top.method).numericHandlerIds, null);
  assert.equal(vm.run().returnValue, 3n);
  for (const edit of ['report', 'body', 'decode']) {
    const fallback = new CilVirtualMachine(arithmetic(), {smallLongs: true});
    if (edit === 'report') fallback.report = {...fallback.report};
    else if (edit === 'body') fallback.top.method.instructions = [...fallback.top.method.instructions];
    else fallback.options.decodePlans = false;
    if (edit !== 'decode') assert.equal(getDecodePlan(fallback, fallback.top.method).numericHandlerIds, null);
    assert.equal(fallback.run().returnValue, 3n);
  }
});

test('snapshot replay preserves BigInt arrays, aliases and managed roots', () => {
  const vm = new CilVirtualMachine(loop(true), {smallLongs: true});
  vm.step();
  vm.step();
  const caller = vm.top;
  vm.call(caller.method.token, []);
  vm.top.locals = caller.locals;
  const reference = vm.heap.string('root next to long');
  vm.dereference(vm.address('local', 3), true, reference);
  vm.heap.collect();
  assert.equal(vm.heap.get(reference).data, 'root next to long');
  const saved = vm.snapshot();
  assert.equal(saved.frames[0].locals, saved.frames[1].locals);
  assert.equal(floatSlots(saved.frames[0].locals), null);
  assert.equal(saved.frames[0].locals[0], 0n);
  assert.doesNotThrow(() => structuredClone(saved.frames[0].locals));
  vm.restore(saved);
  assert.equal(vm.frames[0].locals, vm.frames[1].locals);
  vm.dereference(vm.address('local', 0), true, 17n);
  assert.equal(vm.frames[0].locals[0], 17n);
  vm.heap.collect();
  assert.equal(vm.heap.get(vm.top.locals.at(-1)).data, 'root next to long');
  vm.stop();
});

test('parked operands restore and cancellation clears private long planes', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2, body(writer, context) {
    writer.op('ldc.i8', 17n).integer(1)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {smallLongs: true, virtualTime: true, maxStackBytes: 32});
  const stack = vm.top.stack;
  assert.equal(vm.run().state, 'waiting');
  const saved = vm.snapshot();
  vm.stop();
  assert.equal(stack.length, 0);
  assert.equal(floatSlots(stack).tags.some(Boolean), false);
  vm.restore(saved);
  vm.scheduler.advance(1);
  assert.equal(vm.run().returnValue, 17n);
  vm.restore(saved);
  vm.stop();
  assert([...vm.scheduler.contexts.values()].every(context => context.frames.length === 0));
});

test('long arguments and stack quotas still cross the existing call/admission boundaries', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'long', maxStack: 1,
      body: (writer, context) => writer.op('ldc.i8', 7n).op('call', context.methods.Next).op('ret')},
    {name: 'Next', result: 'long', parameters: ['long'], maxStack: 2,
      body: writer => writer.op('ldarg.0').op('ldc.i8', 1n).op('add').op('starg.s', 0).op('ldarg.0').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes, {smallLongs: true});
  vm.step();
  vm.step();
  assert.equal(vm.top.args[0], 7n);
  assert(getDecodePlan(vm, vm.top.method).numericHandlerIds.includes('starg_s_small_i8'));
  assert.equal(vm.run().returnValue, 8n);
  const limited = new CilVirtualMachine(arithmetic(), {smallLongs: true, maxStackBytes: 32});
  limited.step();
  limited.options.maxStackBytes = 31;
  assert.throws(() => limited.step(), {name: 'StackOverflowException'});
  assert.equal(limited.top.pc, 1);
  assert.equal(limited.top.stack[0], 1n);
  limited.options.maxStackBytes = 32;
  assert.equal(limited.run().returnValue, 3n);
});
