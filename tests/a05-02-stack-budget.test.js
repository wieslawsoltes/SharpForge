import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {image} from './helpers.js';
import {
  ManagedStackBudget, defaultStackBytes, frameStackBytes, rebuildStackBudget, validateStackSnapshot
} from '../packages/runtime/src/execution/stack-budget.js';

const source = `class Program {
  static int Count(int remaining) {
    if (remaining == 0) return 0;
    return Count(remaining - 1) + 1;
  }
  static int Main() { return Count(10000); }
}`;

function recursion(depth = 10000, catchOverflow = false) {
  return controlFixture([{name: 'Program', methods: [
    {
      name: 'Main', result: 'int', locals: ['int'], maxStack: 1,
      body(writer, context) {
        writer.label('try').op('ldc.i4', depth).op('call', context.methods.get('Program.Count')).op('stloc.0');
        writer.op('leave', 'done').label('tryEnd');
        if (catchOverflow) writer.label('catch').op('pop').op('ldc.i4.m1').op('stloc.0').op('leave', 'done').label('catchEnd');
        writer.label('done').op('ldloc.0').op('ret');
      },
      handlers: catchOverflow ? (labels, context) => [{
        start: labels.get('try'), end: labels.get('tryEnd'), target: labels.get('catch'),
        handlerEnd: labels.get('catchEnd'), catchType: context.resolve('System.Exception')
      }] : undefined
    },
    {
      name: 'Count', result: 'int', parameters: ['int'], maxStack: 2,
      body(writer, context) {
        writer.op('ldarg.0').op('brfalse', 'done').op('ldarg.0').op('ldc.i4.1').op('sub');
        writer.op('call', context.methods.get('Program.Count')).op('ldc.i4.1').op('add').op('ret');
        writer.label('done').op('ldc.i4.0').op('ret');
      }
    }
  ]}]);
}

for (const [engine, create] of [
  ['source', options => new VirtualMachine(image(source), options)],
  ['CIL', options => new CilVirtualMachine(recursion(), options)]
]) {
  test(`T02.10 ${engine}: ten thousand small calls fit the default byte budget`, () => {
    const vm = create();
    let maximum = 0;
    while (vm.state === 'ready' || vm.state === 'running') {
      vm.runSlice({instructionBudget: 100, timeBudgetMs: 1000});
      maximum = Math.max(maximum, vm.frames.length);
    }
    assert.equal(vm.state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 10000);
    assert(maximum > 9900);
    assert.equal(vm.stackBudget.limit, defaultStackBytes);
    assert.equal(vm.stackBudget.frames.size, 0);
    assert.equal(vm.frameIndex.size, 0);
  });
}

test('T02.10 an exact byte boundary admits a frame and one byte less rejects it atomically', () => {
  const vm = new CilVirtualMachine(recursion(0));
  const frame = vm.top;
  const bytes = frameStackBytes(vm, frame);
  const exact = new ManagedStackBudget({...vm, options: {maxStackBytes: bytes}});
  exact.register(frame, 1);
  assert.equal(exact.contexts.get(1), bytes);
  exact.register(frame, 1);
  assert.equal(exact.contexts.get(1), bytes);
  const short = new ManagedStackBudget({...vm, options: {maxStackBytes: bytes - 1}});
  assert.throws(() => short.register(frame), {name: 'StackOverflowException'});
  assert.equal(short.frames.size, 0);
  assert.equal(short.contexts.size, 0);
  exact.release(frame);
  exact.release(frame);
  assert.equal(exact.contexts.size, 0);
});

test('T02.10 CIL stack exhaustion bypasses catch(Exception)', () => {
  const vm = new CilVirtualMachine(recursion(10000, true), {maxStackBytes: 1024});
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'StackOverflowException');
  assert.equal(result.fault.fatal, true);
  assert.equal(result.fault.runtimeOrigin, true);
  assert.notEqual(result.returnValue, -1);
});

test('T02.10 source stack exhaustion bypasses catch(Exception)', () => {
  const guarded = source.replace('return Count(10000);', 'try { return Count(10000); } catch (Exception ex) { return -1; }');
  const result = new VirtualMachine(image(guarded), {maxStackBytes: 1024}).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'StackOverflowException');
  assert.equal(result.fault.fatal, true);
  assert.notEqual(result.returnValue, -1);
});

test('T02.10 parked contexts have independent budgets and restore accounting is derived', () => {
  const vm = new CilVirtualMachine(recursion(0));
  const first = vm.top;
  const second = {...first, id: first.id + 1};
  const bytes = frameStackBytes(vm, first);
  vm.options.maxStackBytes = bytes;
  vm.scheduler.enabled = true;
  vm.scheduler.currentId = 1;
  vm.scheduler.parked = false;
  vm.scheduler.contexts = new Map([
    [1, {status: 'running', frames: []}],
    [2, {status: 'ready', frames: [second]}]
  ]);
  const budget = rebuildStackBudget(vm);
  assert.equal(budget.contexts.get(1), bytes);
  assert.equal(budget.contexts.get(2), bytes);
  const snapshot = {frames: [first], scheduler: {
    currentId: 1, contexts: [[1, {status: 'running', frames: []}], [2, {status: 'ready', frames: [second]}]]
  }};
  validateStackSnapshot(vm, snapshot);
  second.stackBytes++;
  assert.throws(() => validateStackSnapshot(vm, snapshot), /stack accounting/);
});
