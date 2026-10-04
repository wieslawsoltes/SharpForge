import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, Binary} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, framePoolStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {framePool} from '../packages/runtime/src/execution/frame-pool.js';

const local = (type, slot) => ({type, slot, name: 'v' + slot});
function method(id, code, types = [], parameters = []) {
  return {id, name: id ? 'Echo' : 'Main', qualifiedName: id ? 'Echo' : 'Main', owner: null, isStatic: true,
    returnType: 'int', parameters, handlers: [], locals: types.map(local), code: Int32Array.from(code)};
}
function image(methods = [method(0, [Op.CONST, 0, 0, Op.RET, 0, 0])]) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [40, 2], types: [], statics: [],
    sequencePoints: [], sources: [], methods};
}
function nested() {
  return image([
    method(0, [Op.CONST, 0, 0, Op.CONST, 1, 0, Op.CALL, 1, 1, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0]),
    method(1, [Op.LDLOC, 0, 0, Op.RET, 0, 0], ['int'], [{name: 'value', type: 'int'}])
  ]);
}
const fault = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};
const one = vm => vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});

for (const maxStackBytes of [0, 15, -1, NaN, Infinity, '24']) {
  test(`source rejects invalid byte limit ${String(maxStackBytes)} before frame allocation`, () => {
    assert.throws(() => new VirtualMachine(image(), {maxStackBytes}), /safe integer of at least 16 bytes/);
  });
}

test('source entry reserves its verified peak and source arguments are counted only in locals', () => {
  assert.throws(() => new VirtualMachine(image(), {maxStackBytes: 23}), fault);
  const simple = new VirtualMachine(image(), {maxStackBytes: 24});
  assert.equal(simple.run().state, 'terminated');
  assert.equal(simple.returnValue, 40);
  const vm = new VirtualMachine(nested(), {maxStackBytes: 64});
  assert.equal(vm.run().state, 'terminated', vm.fault?.message);
  assert.equal(vm.returnValue, 42);
  const rejected = new VirtualMachine(nested(), {maxStackBytes: 63});
  assert.equal(rejected.run().fault?.name, 'StackOverflowException');
  assert.equal(rejected.frames.length, 1);
  assert.equal(framePoolStatistics(rejected).framesAllocated, 1);
});

test('construction failure rolls back source reservation before a subsequent call', () => {
  const vm = new VirtualMachine(image(), {maxStackBytes: 48}), pool = framePool(vm), acquire = pool.acquire;
  pool.acquire = () => { throw new Error('allocation failed'); };
  assert.throws(() => vm.call(0, []), /allocation failed/);
  assert.equal(vm.frames.length, 1);
  pool.acquire = acquire;
  vm.call(0, []);
  assert.equal(vm.frames.length, 2);
  vm.stop();
  vm.call(0, []);
  vm.state = 'running';
  assert.equal(vm.run().state, 'terminated');
});

test('a source catch cannot turn byte-budget overflow into successful execution', () => {
  const program = nested(), main = program.methods[0];
  main.locals.push(local('Exception', 0));
  main.handlers.push({kind: 'catch', start: 2, end: 3, target: 5, slot: 0});
  main.code = Int32Array.from([...main.code, Op.CONST, 0, 0, Op.RET, 0, 0]);
  const vm = new VirtualMachine(program, {maxStackBytes: 71});
  assert.equal(vm.run().state, 'faulted');
  assert.equal(vm.fault.name, 'StackOverflowException');
  assert.equal(vm.returnValue, null);
});

for (const nativeIntBits of [32, 64]) {
  test(`source scalar local widths include Decimal and configured native ABI${nativeIntBits}`, () => {
    const make = () => image([method(0, [Op.CONST, 0, 0, Op.RET, 0, 0], ['decimal', 'nint', 'char'])]);
    assert.throws(() => new VirtualMachine(make(), {nativeIntBits, maxStackBytes: 55}), fault);
    assert.equal(new VirtualMachine(make(), {nativeIntBits, maxStackBytes: 56}).run().state, 'terminated');
  });
}

test('host limit edits reject before pc, instruction count and profiler dispatch advance', () => {
  const vm = new VirtualMachine(image(), {maxStackBytes: 24, profile: true});
  one(vm);
  const pc = vm.top.pc, count = vm.instructions;
  vm.options.maxStackBytes = 23;
  const result = vm.run();
  assert.equal(result.fault.name, 'StackOverflowException');
  assert.equal(vm.top.pc, pc);
  assert.equal(vm.instructions, count);
  assert.deepEqual(vm.stack, [40]);
  delete vm.options.maxStackBytes;
  vm.state = 'running';
  assert.equal(vm.run().state, 'terminated');
});

test('re-enabling the quota includes a context enqueued while admission was disabled', () => {
  const vm = new VirtualMachine(image(), {maxStackBytes: 24, virtualTime: true});
  one(vm);
  const pc = vm.top.pc, count = vm.instructions;
  delete vm.options.maxStackBytes;
  const delegate = vm.platform.make('System.Func`1<int>', {method: 0, receiver: null}, 'delegate');
  vm.scheduler.enqueue(delegate);
  vm.options.maxStackBytes = 24;
  assert.equal(vm.run().fault.name, 'StackOverflowException');
  assert.equal(vm.top.pc, pc);
  assert.equal(vm.instructions, count);
  vm.stop();
});

test('new source bodies are reverified, and in-place edits use explicit code invalidation', () => {
  for (const inPlace of [false, true]) {
    const initial = image([method(0, [Op.CONST, 0, 0, Op.POP, 0, 0, Op.CONST, 1, 0, Op.NOP, 0, 0, Op.RET, 0, 0])]);
    const vm = new VirtualMachine(initial, {maxStackBytes: 24});
    const replacement = Int32Array.from([Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.NOP, 0, 0, Op.RET, 0, 0]);
    if (inPlace) {
      initial.methods[0].code.set(replacement);
      invalidateExecutionCode(vm, 'committed-source-edit');
    } else initial.methods[0].code = replacement;
    assert.equal(vm.run().fault.name, 'StackOverflowException');
    assert.equal(vm.top.pc, 0);
    vm.options.maxStackBytes = 32;
    vm.state = 'ready';
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 42);
  }
  const vm = new VirtualMachine(image(), {maxStackBytes: 24});
  vm.image.methods[0].code = Int32Array.from([Op.POP, 0, 0, Op.RET, 0, 0]);
  assert.equal(vm.run().fault.name, 'InvalidProgramException');
  assert.equal(vm.instructions, 0);
});

test('active shared-stack snapshot preflight is atomic and replay reconstructs the same reservations', () => {
  const vm = new VirtualMachine(nested(), {maxStackBytes: 64});
  for (let index = 0; index < 3; index++) one(vm);
  assert.equal(vm.frames.length, 2);
  assert.deepEqual(vm.stack, [40]);
  const saved = vm.snapshot(), frames = vm.frames, revision = vm.heap.mutationRevision;
  vm.options.maxStackBytes = 63;
  assert.throws(() => vm.restore(saved), /Snapshot exceeds managed stack byte budget/);
  assert.equal(vm.frames, frames);
  assert.equal(vm.heap.mutationRevision, revision);
  vm.options.maxStackBytes = 64;
  const invalid = vm.snapshot();
  invalid.stack.push(1, 2);
  assert.throws(() => vm.restore(invalid), /verified source stack bound/);
  const prefix = vm.snapshot();
  prefix.stack.unshift(99);
  for (const frame of prefix.frames) frame.base++;
  assert.throws(() => vm.restore(prefix), /verified source stack bound/);
  assert.equal(vm.frames, frames);
  assert.equal(vm.heap.mutationRevision, revision);
  vm.restore(saved);
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.returnValue, 42);
  assert.equal(Object.hasOwn(saved, 'stackBudget'), false);
});

function compiled(source) {
  const result = compileToIL(source);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return result;
}
const synchronous = 'class P { static int Twice(int x) { try { return x * 2; } finally { Console.WriteLine(x); } } ' +
  'static void Main() { Console.WriteLine(2 + Twice(20)); } }';
for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: typed calls and finally returns preserve output with logical byte admission`, () => {
    const result = compiled(synchronous), options = {maxStackBytes: 4096};
    const vm = engine === 'cil' ? new CilVirtualMachine(result.assembly, options)
      : new VirtualMachine(engine === 'reload' ? result.assembly : result.image, options);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.output.join(''), '20\n42\n');
    vm.stop();
  });
}

for (const engine of ['source', 'reload']) {
  test(`${engine}: parked async frames participate in restore quotas and release on cancellation`, () => {
    const result = compiled('using System.Threading.Tasks; class P { static async Task Main() { ' +
      'await Task.Delay(60000); Console.WriteLine(42); } }');
    const vm = new VirtualMachine(engine === 'source' ? result.image : result.assembly,
      {virtualTime: true, maxStackBytes: 65536});
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    const saved = vm.snapshot(), contexts = vm.scheduler.contexts, revision = vm.heap.mutationRevision;
    vm.options.maxStackBytes = 16;
    assert.throws(() => vm.restore(saved), /Snapshot exceeds managed stack byte budget/);
    assert.equal(vm.scheduler.contexts, contexts);
    assert.equal(vm.heap.mutationRevision, revision);
    vm.options.maxStackBytes = 65536;
    vm.restore(saved);
    vm.state = 'waiting'; // Source restore deliberately pauses; resume the parked scheduler.
    vm.scheduler.advance(60000);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.output.join(''), '42\n');
    vm.restore(saved);
    vm.stop();
    assert.equal(vm.allFrames().length, 0, 'cancellation releases all parked frames');
    assert.ok([...vm.scheduler.contexts.values()].every(context =>
      ['completed', 'faulted', 'canceled'].includes(context.status)));
    vm.call(vm.image.entryPoint, []);
    assert.equal(vm.frames.length, 1, 'a fresh frame can reserve storage after cancellation');
    vm.stop();
  });
}
