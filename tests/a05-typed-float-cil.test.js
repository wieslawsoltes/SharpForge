import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, invalidateExecutionCode, framePoolStatistics} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {managedFixture} from './managed-fixtures.js';
import {floatSlots} from '../packages/runtime/src/execution/typed-stack.js';

function arithmetic(kind, operation, left, right) {
  return managedFixture({methods: [{name: 'Main', result: kind === 'r4' ? 'float' : 'double', maxStack: 2,
    body: writer => writer.op('ldc.' + kind, left).op('ldc.' + kind, right).op(operation).op('ret')} ]});
}
function loop(referenceLocal = false) {
  const locals = referenceLocal ? ['double', 'int', 'object'] : ['double', 'int'];
  return managedFixture({methods: [{name: 'Main', result: 'double', maxStack: 2, locals,
    body(writer) {
      writer.op('ldc.r8', 0).op('stloc.0').integer(0).op('stloc.1').mark('loop');
      writer.op('ldloc.0').op('ldc.r8', 0.25).op('add').op('stloc.0');
      writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
      writer.op('ldloc.1').integer(100).op('blt.s', 'loop').op('ldloc.0').op('ret');
    }}]});
}
function untilReturn(vm) {
  let remaining = 10_000;
  while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
    assert(--remaining > 0, 'fixture must reach its return');
    vm.step();
  }
}

for (const kind of ['r4', 'r8']) {
  for (const operation of ['add', 'sub', 'mul', 'div', 'rem']) {
    test(`${kind} ${operation}: typed and reference CIL match IEEE boundaries`, () => {
      for (const [left, right] of [[1.25, 0.5], [-0, 1], [0, -1], [1, 0], [Infinity, -Infinity],
        [NaN, 7], [1e-40, 3], [16777216, 1]]) {
        const bytes = arithmetic(kind, operation, left, right);
        const reference = new CilVirtualMachine(bytes).run();
        const actual = new CilVirtualMachine(bytes, {typedNumericStack: true}).run();
        assert.equal(actual.state, reference.state);
        assert(Object.is(actual.returnValue, reference.returnValue), `${left} ${operation} ${right}`);
      }
    });
  }
}

test('a double local accumulator executes through raw planes until its return boundary', () => {
  const vm = new CilVirtualMachine(loop(), {typedNumericStack: true});
  const stack = vm.top.stack, locals = vm.top.locals;
  untilReturn(vm);
  assert.equal(floatSlots(stack).materializations, 0);
  assert.equal(floatSlots(locals).materializations, 0);
  assert.equal(vm.run().returnValue, 25);
  assert.equal(stack.length, 0, 'pool retirement clears published stack storage');
  assert.equal(locals.length, 0);
  assert.equal(floatSlots(stack).tags.some(Boolean), false);
  assert.equal(floatSlots(locals).tags.some(Boolean), false);
  assert(framePoolStatistics(vm).released > 0);
  vm.call(vm.inspector.pe.entryPoint, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 25);
  vm.stop();
});

test('default, decode-disabled and explicitly disabled modes preserve the ordinary path', () => {
  for (const options of [{}, {typedNumericStack: false}]) {
    const vm = new CilVirtualMachine(loop(), options);
    assert.equal(floatSlots(vm.top.stack), null);
    assert.equal(vm.run().returnValue, 25);
  }
  const vm = new CilVirtualMachine(loop(), {typedNumericStack: true, decodePlans: false});
  assert.equal(vm.run().returnValue, 25);
});

test('debugger stores, byref writes and edited runtime tags retain normal adapters', () => {
  const vm = new CilVirtualMachine(loop(), {typedNumericStack: true});
  const writes = [];
  vm.onWrite = write => writes.push(write);
  vm.step();
  vm.step();
  assert.equal(writes[0].value.value, 0);
  vm.dereference(vm.address('local', 0), true, float(10.5));
  assert.equal(vm.top.locals[0].value, 10.5);
  vm.onWrite = null;
  assert.equal(vm.run().returnValue, 35.5);
  const edited = new CilVirtualMachine(arithmetic('r8', 'add', 2, 3), {typedNumericStack: true});
  edited.step();
  edited.step();
  edited.top.stack[0] = 7;
  assert.equal(edited.run().returnValue, 10, 'actual integer tag falls back to generic mixed arithmetic');
});

test('host replacement arrays, descriptors and replaced code retain reference semantics', () => {
  for (const edit of ['array', 'descriptor', 'code']) {
    const vm = new CilVirtualMachine(arithmetic('r8', 'add', 2, 3), {typedNumericStack: true});
    vm.step();
    vm.step();
    if (edit === 'array') vm.top.stack = [float(10), float(20)];
    else if (edit === 'descriptor') Object.defineProperty(vm.top.stack, '0', {value: float(10)});
    else {
      vm.top.method.instructions = [...vm.top.method.instructions];
      invalidateExecutionCode(vm, 'host-body-replaced');
    }
    assert.equal(vm.run().returnValue, edit === 'array' ? 30 : edit === 'descriptor' ? 13 : 5);
  }
});

test('snapshot capture materializes plain arrays; replay restores tags and live reference roots', () => {
  const vm = new CilVirtualMachine(loop(true), {typedNumericStack: true});
  for (let index = 0; index < 6; index++) vm.step();
  const reference = vm.heap.string('only frame root');
  vm.top.locals[2] = reference;
  vm.heap.collect();
  assert.equal(vm.heap.get(reference).data, 'only frame root');
  const saved = vm.snapshot();
  assert.equal(floatSlots(saved.frames[0].stack), null);
  assert.equal(floatSlots(saved.frames[0].locals), null);
  assert.doesNotThrow(() => structuredClone(saved.frames[0].stack));
  assert.equal(vm.run().returnValue, 25);
  vm.restore(saved);
  assert(floatSlots(vm.top.stack));
  assert.equal(vm.top.locals.at(-1).h, reference.h);
  vm.heap.collect();
  assert.equal(vm.heap.get(vm.top.locals.at(-1)).data, 'only frame root');
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 25);
  vm.stop();
});

test('float arguments retain narrowing, while checked-finite faults take the normal catch path', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'double', maxStack: 1, locals: ['double'], body(writer, context) {
      writer.mark('try').op('ldc.r8', Infinity).op('ckfinite').op('pop').op('leave.s', 'done');
      writer.mark('catch').op('pop').op('ldc.r8', 16777217).op('call', context.methods.Narrow);
      writer.op('stloc.0').op('leave.s', 'done').mark('done').op('ldloc.0').op('ret');
    }, handlers: (labels, context) => [{start: labels.get('try'), end: labels.get('catch'),
      target: labels.get('catch'), handlerEnd: labels.get('done'), catchType: context.resolve('System.ArithmeticException')}]},
    {name: 'Narrow', parameters: ['float'], result: 'double', maxStack: 1,
      body: writer => writer.op('ldarg.0').op('conv.r8').op('ret')}
  ]});
  for (const typedNumericStack of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {typedNumericStack});
    assert.equal(vm.run().returnValue, 16777216);
  }
});

test('parked float operands replay and cancellation clears retained planes', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'double', maxStack: 2, body(writer, context) {
    writer.op('ldc.r8', 1.25).integer(1)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {typedNumericStack: true, virtualTime: true, maxStackBytes: 32});
  const stack = vm.top.stack;
  assert.equal(vm.run().state, 'waiting');
  const saved = vm.snapshot();
  vm.stop();
  assert.equal(stack.length, 0);
  assert.equal(floatSlots(stack).tags.some(Boolean), false);
  vm.restore(saved);
  vm.scheduler.advance(1);
  assert.equal(vm.run().returnValue, 1.25);
  vm.restore(saved);
  vm.stop();
  assert.equal(vm.frames.length, 0);
  assert([...vm.scheduler.contexts.values()].every(context => context.frames.length === 0));
});

test('typed pushes keep verified maxstack and live byte quotas', () => {
  const bytes = arithmetic('r8', 'add', 1, 2);
  assert.throws(() => new CilVirtualMachine(bytes, {typedNumericStack: true, maxStackValues: 1}),
    {name: 'ExecutionLimitException'});
  const malformed = managedFixture({methods: [{name: 'Main', result: 'double', maxStack: 0,
    body: writer => writer.op('ldc.r8', 1).op('ret')} ]});
  assert.throws(() => new CilVirtualMachine(malformed, {typedNumericStack: true}), /verification failed/);
  const vm = new CilVirtualMachine(bytes, {typedNumericStack: true, maxStackBytes: 32});
  vm.step();
  vm.options.maxStackBytes = 31;
  assert.throws(() => vm.step(), {name: 'StackOverflowException'});
  assert.equal(vm.top.pc, 1);
  assert.equal(vm.top.stack[0].value, 1);
  vm.options.maxStackBytes = 32;
  assert.equal(vm.run().returnValue, 3);
});

test('restore preserves shared local-array aliases and ordinary copied reports never grant proof', () => {
  const vm = new CilVirtualMachine(loop(), {typedNumericStack: true});
  vm.step();
  vm.step();
  const caller = vm.top;
  vm.call(caller.method.token, []);
  vm.top.locals = caller.locals;
  const saved = vm.snapshot();
  assert.equal(saved.frames[0].locals, saved.frames[1].locals);
  vm.restore(saved);
  assert.equal(vm.frames[0].locals, vm.frames[1].locals);
  vm.dereference(vm.address('local', 0), true, float(7));
  assert.equal(vm.frames[0].locals[0].value, 7);
  vm.stop();
  const unproven = new CilVirtualMachine(arithmetic('r8', 'mul', 3, 7), {typedNumericStack: true});
  unproven.report = {...unproven.report};
  assert.equal(unproven.run().returnValue, 21);
});
