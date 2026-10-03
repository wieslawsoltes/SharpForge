import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, executionCodeStatistics, invalidateExecutionCode,
  serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {getSourceFusionPlan} from '../packages/runtime/src/execution/source-fusion.js';
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

test('T07 source superinstructions preserve every bounded slice and local write count', () => {
  for (const budget of [1, 2, 3, 4, 5, 7, 8, 255, 256, 257]) {
    const ordinary = machine(false), fused = machine(true);
    while (['ready', 'running'].includes(ordinary.state)) {
      ordinary.runSlice({instructionBudget: budget, timeBudgetMs: 1000});
      fused.runSlice({instructionBudget: budget, timeBudgetMs: 1000});
      assert.deepEqual(visible(fused), visible(ordinary), `budget ${budget}`);
    }
    assert.equal(fused.returnValue, 42);
    if (budget >= 4) assert(executionCodeStatistics(fused).sourceFusionGroups > 0);
  }
});

test('T07 fused faults retain the failing PC and partial stack before exception dispatch', () => {
  for (const options of [
    {locals: [6]},
    {locals: [6, 0], image: sourceFusionFixture({operator: '/'})},
    {locals: [2147483647, 1], image: sourceFusionFixture({operator: '+', mode: 5})},
  ]) {
    const ordinary = machine(false, options), fused = machine(true, options);
    ordinary.run(); fused.run();
    assert.equal(fused.state, 'faulted');
    assert.deepEqual(visible(fused), visible(ordinary));
    assert(executionCodeStatistics(fused).sourceFusionGroups > 0);
  }
});

test('T07 fusion cannot overshoot the global instruction limit', () => {
  for (let maxInstructions = 0; maxInstructions < 18; maxInstructions++) {
    const ordinary = machine(false, {maxInstructions}), fused = machine(true, {maxInstructions});
    ordinary.run(); fused.run();
    assert.deepEqual(visible(fused), visible(ordinary), `limit ${maxInstructions}`);
  }
});

test('T07 a branch entering the middle of a candidate prevents that fusion', () => {
  const vm = machine(true, {image: sourceFusionFixture({entry: true})});
  const plan = getSourceFusionPlan(vm, vm.top && vm.image.methods[vm.top.methodId]);
  assert.equal(plan.groups[2], null);
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.returnValue, 13);
});

test('T07 code-array replacement, Hot Reload epochs and stop discard source plans', () => {
  const vm = machine(true), method = vm.image.methods[vm.top.methodId];
  const initial = getSourceFusionPlan(vm, method);
  assert(Object.isFrozen(initial) && Object.isFrozen(initial.groups));
  assert.equal(getSourceFusionPlan(vm, method), initial);
  method.code = method.code.slice();
  const replaced = getSourceFusionPlan(vm, method);
  assert.notEqual(replaced, initial);
  invalidateExecutionCode(vm, 'hot-reload');
  assert.notEqual(getSourceFusionPlan(vm, method), replaced);
  vm.stop();
  assert.equal(executionCodeStatistics(vm).sourcePlans, 0);
});

test('T07 observers, instruction GC, profiling and armed scheduling retain individual instructions', () => {
  for (const configure of [
    vm => { vm.onWrite = () => {}; }, vm => { vm.onException = () => false; },
    vm => { vm.options.gcStress = 'instruction'; }, vm => { vm.options.profile = true; },
    vm => { vm.scheduler.ensure(); },
  ]) {
    const vm = machine(true);
    configure(vm);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 42);
    assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
  }
  const vm = machine(true);
  vm.scheduler.beforeInstruction = vm.scheduler.afterInstruction = () => assert.fail('inactive scheduler hook');
  assert.equal(vm.run().state, 'terminated');
});

const program = `class P {
  static int Fib(int n){if(n<2)return n;return Fib(n-1)+Fib(n-2);}
  static void Main(){int sum=0;for(int i=0;i<20;i++)sum+=i;Console.WriteLine(sum);Console.WriteLine(Fib(10));}
}`;
for (const reloaded of [false, true]) {
  test(`T07 ${reloaded ? 'reloaded' : 'source'} output and sequence-point stepping match ordinary dispatch`, () => {
    const artifact = compileToIL(program);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const image = reloaded ? loadAssembly(artifact.assembly) : artifact.image;
    for (const stepping of [false, true]) {
      const runs = [];
      for (const sourceFusion of [false, true]) {
        const vm = new VirtualMachine(image, {sourceFusion}), points = [];
        const onSequence = stepping ? point => { points.push([point.methodId, point.offset]); return false; } : null;
        while (['ready', 'running'].includes(vm.state)) vm.runSlice({instructionBudget: 127, timeBudgetMs: 1000, onSequence});
        runs.push({state: vm.state, output: vm.output.join(''), instructions: vm.instructions, points});
        if (stepping) assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
      }
      assert.deepEqual(runs[1], runs[0]);
      assert.equal(runs[1].state, 'terminated');
      assert.equal(runs[1].output, '190\n55\n');
    }
  });
}

test('T07 portable restore reconstructs private source plans without serializing executable closures', async () => {
  const image = sourceFusionFixture(), original = machine(true, {image});
  const plan = getSourceFusionPlan(original, image.methods[0]);
  original.runSlice({instructionBudget: 4, timeBudgetMs: 1000});
  const wire = await serializeSnapshot(original, original.snapshot(), {json: true});
  const fresh = machine(true, {image});
  await restoreSerializedSnapshot(fresh, wire);
  assert.equal(executionCodeStatistics(fresh).sourcePlans, 0);
  assert.notEqual(getSourceFusionPlan(fresh, image.methods[0]), plan);
  original.run(); fresh.run();
  assert.deepEqual(visible(fresh), visible(original));
});
