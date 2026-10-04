import test from 'node:test';
import assert from 'node:assert/strict';
import {Op, Binary, numericMode, float, decimalParse} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, executionCodeStatistics, invalidateExecutionCode, instructionProfile} from '@sharpforge/runtime';
import {getSourceFusionPlan, prepareSourceExecution} from '../packages/runtime/src/execution/source-fusion.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function machine(sourceFusion, {image = sourceFusionFixture(), locals = [6, 7], ...options} = {}) {
  const vm = new VirtualMachine(image, {sourceFusion, ...options});
  for (const [index, value] of locals.entries()) vm.top.locals[index] = value;
  return vm;
}

function visible(vm) {
  return {state: vm.state, output: vm.output.join(''), instructions: vm.instructions, writes: vm.writeRevision,
    result: vm.returnValue, stack: [...vm.stack],
    frames: vm.frames.map(frame => ({pc: frame.pc, locals: [...frame.locals]})),
    fault: vm.fault && {name: vm.fault.name, message: vm.fault.message, frames: vm.fault.frames}};
}

test('source fusion preserves every bounded slice, retained store value and local write count', () => {
  for (const budget of [1, 2, 3, 4, 5, 7, 8, 255, 256, 257]) {
    const ordinary = machine(false), fused = machine(true);
    while (['ready', 'running'].includes(ordinary.state)) {
      ordinary.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
      fused.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
      assert.deepEqual(visible(fused), visible(ordinary), `budget ${budget}`);
    }
    assert.equal(fused.returnValue, 42);
    if (budget >= 5) assert(executionCodeStatistics(fused).sourceFusionGroups > 0);
  }
});

test('faulting fused loads and arithmetic preserve the failing PC, partial stack and charge', () => {
  for (const options of [
    {locals: [6]},
    {locals: [6, 0], image: sourceFusionFixture({operator: '/'})},
    {locals: [2147483647, 1], image: sourceFusionFixture({operator: '+', mode: 5})}
  ]) {
    const states = [];
    for (const enabled of [false, true]) {
      const vm = machine(enabled, options), faults = [], handleFault = vm.handleFault;
      vm.handleFault = fault => {
        faults.push({pc: vm.top.pc, instructions: vm.instructions, stack: [...vm.stack], name: fault.name});
        return handleFault.call(vm, fault);
      };
      vm.run();
      assert.equal(vm.state, 'faulted');
      states.push({visible: visible(vm), faults});
      if (enabled) assert(executionCodeStatistics(vm).sourceFusionGroups > 0);
    }
    assert.deepEqual(states[1], states[0]);
  }
});

test('source fusion neither crosses the instruction limit nor suppresses stack admission', () => {
  for (let maxInstructions = 0; maxInstructions < 20; maxInstructions++) {
    const ordinary = machine(false, {maxInstructions}), fused = machine(true, {maxInstructions});
    ordinary.run();
    fused.run();
    assert.deepEqual(visible(fused), visible(ordinary), `limit ${maxInstructions}`);
  }
  const ordinary = machine(false, {maxStackBytes: 256}), fused = machine(true, {maxStackBytes: 256});
  for (const vm of [ordinary, fused]) {
    vm.options.maxStackBytes = 16;
    assert.equal(vm.run().state, 'faulted');
    assert.equal(vm.instructions, 0);
    assert.equal(vm.top.pc, 0);
  }
  assert.deepEqual(visible(fused), visible(ordinary));
});

test('source fusion cannot skip the 256-instruction wall-clock polling boundary', context => {
  const image = sourceFusionFixture(), code = [];
  image.constants[0] = 1;
  for (let index = 0; index < 70; index++) {
    code.push(Op.LDLOC, 0, 0, Op.CONST, 0, 0, Op.BINARY, Binary['+'], 1, Op.STLOC, 0, 0, Op.POP, 0, 0);
  }
  image.methods[0].code = Int32Array.from([...code, Op.LDLOC, 0, 0, Op.RET, 0, 0]);
  const ordinary = machine(false, {image}), fused = machine(true, {image});
  prepareSourceExecution(fused);
  let reads = 0;
  context.mock.method(performance, 'now', () => reads++ < 2 ? 0 : 20);
  for (const vm of [ordinary, fused]) {
    reads = 0;
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 8});
    assert.equal(vm.instructions, 256);
    assert.equal(vm.state, 'running');
  }
  assert.deepEqual(visible(fused), visible(ordinary));
});

test('a branch entering a candidate interior prevents its fusion', () => {
  const vm = machine(true, {image: sourceFusionFixture({entry: true})});
  assert.equal(getSourceFusionPlan(vm, vm.image.methods[0]).groups[2], null);
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.returnValue, 13);
});

test('preparation reports real work, remains private and follows code/owner/epoch replacement and stop', () => {
  const vm = machine(true), method = vm.image.methods[0];
  const initial = getSourceFusionPlan(vm, method);
  assert(Object.isFrozen(initial) && Object.isFrozen(initial.groups));
  assert.equal(getSourceFusionPlan(vm, method), initial);
  assert.deepEqual(prepareSourceExecution(vm), {status: 'prepared', methods: 1, fusedInstructions: 14});
  assert.equal(executionCodeStatistics(vm).sourcePlans, 1);
  assert.equal(Object.hasOwn(vm.snapshot(), 'source'), false);
  method.code = method.code.slice();
  const replaced = getSourceFusionPlan(vm, method);
  assert.notEqual(replaced, initial);
  invalidateExecutionCode(vm, 'committed-source-edit');
  assert.notEqual(getSourceFusionPlan(vm, method), replaced);
  vm.image = {...vm.image};
  assert.equal(executionCodeStatistics(vm).sourcePlans, 0);
  prepareSourceExecution(vm);
  vm.stop();
  assert.equal(executionCodeStatistics(vm).sourcePlans, 0);
  assert.deepEqual(prepareSourceExecution(machine(false)), {status: 'disabled', methods: 0, fusedInstructions: 0});
});

test('source fusion resumes after ordinary in-memory snapshot replay without serializing a plan', () => {
  const vm = machine(true);
  vm.runSlice({instructionBudget: 7, timeBudgetMs: Infinity});
  const snapshot = vm.snapshot();
  vm.run();
  const expected = visible(vm);
  vm.restore(snapshot);
  vm.run();
  assert.deepEqual(visible(vm), expected);
});

test('debugger, writes, runtime events, profiler and cooperative contexts retain individual dispatch', () => {
  for (const configure of [
    vm => { vm.onWrite = () => {}; },
    vm => { vm.onException = () => false; },
    vm => { vm.options.gcStress = 'instruction'; },
    vm => { vm.options.profile = true; },
    vm => { vm.scheduler.ensure(); }
  ]) {
    const vm = machine(true);
    configure(vm);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
  }
  const pair = [machine(false, {profile: true, runtimeEvents: true}), machine(true, {profile: true, runtimeEvents: true})];
  for (const vm of pair) vm.run();
  assert.deepEqual(instructionProfile(pair[1]), instructionProfile(pair[0]));
  assert.deepEqual(pair[1].runtimeEvents.export(), pair[0].runtimeEvents.export());
  assert.equal(executionCodeStatistics(pair[1]).sourceFusionGroups, 0);
});

test('current typed source arithmetic retains scalar width, IEEE bits, Decimal scale and store identity', () => {
  const cases = [
    ['int', 2147483647, 1, '-2147483648'], ['uint', -1, 1, '0'],
    ['long', 9007199254740993n, 17n, '9007199254741010'], ['ulong', -1n, 1n, '0'],
    ['float', float(16777216, 'r4'), float(1, 'r4'), '16777216'],
    ['double', float(-0), float(-0), '-0'],
    ['decimal', decimalParse('1.10'), decimalParse('2.20'), '3.30']
  ];
  for (const [type, left, right, expected] of cases) {
    const image = sourceFusionFixture({mode: numericMode(type)}), method = image.methods[0];
    method.returnType = type;
    method.locals = method.locals.map(local => ({...local, type}));
    method.code = Int32Array.from([...method.code.slice(0, 15), Op.LDLOC, 2, 0, Op.RET, 0, 0]);
    const ordinary = machine(false, {image, locals: [left, right]}), fused = machine(true, {image, locals: [left, right]});
    ordinary.run();
    fused.run();
    assert.deepEqual(visible(fused), visible(ordinary), type);
    assert.equal(fused.format(fused.returnValue, type), expected, type);
    assert(executionCodeStatistics(fused).sourceFusionGroups > 0);
  }
});

const program = `class P {
  static int Fib(int n) { if (n < 2) return n; return Fib(n - 1) + Fib(n - 2); }
  static void Main() { int sum = 0; for (int i = 0; i < 20; i++) sum += i; Console.WriteLine(sum); Console.WriteLine(Fib(10)); }
}`;

for (const reloaded of [false, true]) {
  test(`${reloaded ? 'reloaded' : 'source'} execution preserves output and exact sequence stops`, () => {
    const artifact = compileToIL(program);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    const image = reloaded ? loadAssembly(artifact.assembly) : artifact.image;
    for (const stepping of [false, true]) {
      const results = [];
      for (const sourceFusion of [false, true]) {
        const vm = new VirtualMachine(image, {sourceFusion}), points = [];
        const onSequence = stepping ? point => { points.push([point.methodId, point.offset]); return false; } : null;
        while (['ready', 'running'].includes(vm.state)) vm.runSlice({instructionBudget: 127, timeBudgetMs: Infinity, onSequence});
        results.push({state: vm.state, output: vm.output.join(''), instructions: vm.instructions, points});
        if (stepping) assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
        else if (sourceFusion) assert(executionCodeStatistics(vm).sourceFusionGroups > 0);
      }
      assert.deepEqual(results[1], results[0]);
      assert.equal(results[1].state, 'terminated');
      assert.equal(results[1].output, '190\n55\n');
    }
  });
}
