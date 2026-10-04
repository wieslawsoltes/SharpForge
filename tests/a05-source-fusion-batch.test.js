import test from 'node:test';
import assert from 'node:assert/strict';
import {Op, Binary} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {executeSourceFusionBatch} from '../packages/runtime/src/execution/source-fusion-batch.js';
import {getSourceFusionPlan} from '../packages/runtime/src/execution/source-fusion.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function chain({divide = false} = {}) {
  const image = sourceFusionFixture();
  image.constants = [6, 1, 0];
  const entry = image.methods[0];
  entry.locals = [];
  entry.code = Int32Array.from([Op.CONST, 0, 0, Op.CALL, 1, 1, Op.NOP, 0, 0, Op.RET, 0, 0]);
  const parameter = {name: 'value', type: 'int', slot: 0};
  image.methods.push({...entry, id: 1, name: 'Middle', qualifiedName: 'Middle',
    locals: [parameter], parameters: [parameter], code: Int32Array.from([
      Op.LDLOC, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 1, Op.CALL, 2, 1,
      Op.NOP, 0, 0, Op.RET, 0, 0
    ])});
  image.methods.push({...entry, id: 2, name: 'Leaf', qualifiedName: 'Leaf',
    locals: [parameter], parameters: [parameter], code: Int32Array.from([
      Op.LDLOC, 0, 0, Op.CONST, divide ? 2 : 1, 0, Op.BINARY, Binary[divide ? '/' : '+'], 1, Op.RET, 0, 0
    ])});
  return image;
}

function state(vm) {
  return {state: vm.state, instructions: vm.instructions, identity: vm.frameId, result: vm.returnValue,
    stack: [...vm.stack], fault: vm.fault && {name: vm.fault.name, message: vm.fault.message},
    frames: vm.frames.map(frame => ({id: frame.id, method: frame.methodId, pc: frame.pc,
      base: frame.base, locals: [...frame.locals], point: frame.point}))};
}

function compare(image, budget, options = {}) {
  const pair = [false, true].map(sourceFusion => new VirtualMachine(image, {...options, sourceFusion}));
  try {
    while (pair[0].state === 'ready' || pair[0].state === 'running') {
      for (const vm of pair) vm.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
      assert.deepEqual(state(pair[1]), state(pair[0]));
    }
    return state(pair[1]);
  } finally { for (const vm of pair) vm.stop(); }
}

test('one bounded source batch crosses real managed calls and returns with cleared retired storage', () => {
  const image = chain();
  const vm = new VirtualMachine(image);
  const entry = vm.top;
  vm.state = 'running';
  const group = getSourceFusionPlan(vm, image.methods[0]).groups[0];
  assert.equal(executeSourceFusionBatch(vm, entry, group, 256), true);
  assert.equal(vm.state, 'terminated');
  assert.equal(vm.returnValue, 8);
  assert.equal(vm.instructions, 14);
  assert.equal(vm.frameId, 3);
  assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 5);
  assert.equal(entry.locals.length, 0);
  assert.equal(entry.id, undefined);
  vm.stop();
});

test('source batches retain exact intermediate frames and quotas at every call/return boundary', () => {
  for (let budget = 1; budget <= 17; budget++) assert.equal(compare(chain(), budget).result, 8);
  for (const limit of [0, 1, 2, 2.5, 5, 7, 9, 12, 13, 14]) compare(chain(), 256, {maxInstructions: limit});
  for (const options of [{maxFrames: 2}, {maxStackBytes: 64}, {framePooling: false}]) compare(chain(), 256, options);
});

test('a fault in a later batched callee retains its executing method, frame, PC and partial stack', () => {
  const observed = [];
  for (const sourceFusion of [false, true]) {
    const vm = new VirtualMachine(chain({divide: true}), {sourceFusion});
    const faults = [];
    const handle = vm.handleFault;
    vm.handleFault = fault => {
      faults.push({method: vm.top.methodId, frame: vm.top.id, pc: vm.top.pc,
        instructions: vm.instructions, stack: [...vm.stack]});
      return handle.call(vm, fault);
    };
    vm.run();
    assert.equal(vm.fault.name, 'DivideByZeroException');
    assert.equal(faults[0].method, 2);
    observed.push({state: state(vm), faults});
    vm.stop();
  }
  assert.deepEqual(observed[1], observed[0]);
});

test('a batched exception exits before a protected caller resumes catch and finally work', () => {
  const artifact = compileToIL(`class P {
    static int Leaf(int divisor) { return 7 / divisor; }
    static int Middle(int divisor) { return Leaf(divisor) + 1; }
    static int Main() { int result = 0; try { result = Middle(0); }
      catch(System.DivideByZeroException) { result = 5; } finally { result += 2; } return result; }
  }`);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  for (const budget of [1, 3, 7, 32, 256]) assert.equal(compare(artifact.image, budget).result, 7);
});

test('unprepared calls end a batch before the callee body even when its blocks are eligible', () => {
  const image = chain();
  image.methods[1].locals.push({name: 'unusedReference', type: 'object', slot: 1});
  const vm = new VirtualMachine(image);
  vm.state = 'running';
  const group = getSourceFusionPlan(vm, image.methods[0]).groups[0];
  executeSourceFusionBatch(vm, vm.top, group, 256);
  assert.equal(vm.instructions, 2);
  assert.equal(vm.top.methodId, 1);
  assert.equal(vm.top.pc, 0);
  assert.equal(vm.run().state, 'terminated');
  assert.equal(vm.returnValue, 8);
  vm.stop();
});

test('bounded batches preserve live caller stack roots across an allocating callee constant', () => {
  const image = chain();
  image.constants[1] = 'callee-allocation';
  image.methods[0].locals = [{name: 'root', type: 'string', slot: 0}];
  image.methods[0].returnType = image.methods[1].returnType = 'string';
  image.methods[0].code = Int32Array.from([
    Op.LDLOC, 0, 0, Op.CONST, 2, 0, Op.CALL, 1, 1, Op.POP, 0, 0, Op.RET, 0, 0
  ]);
  image.methods[1].code = Int32Array.from([Op.CONST, 1, 0, Op.RET, 0, 0]);
  const results = [];
  for (const sourceFusion of [false, true]) {
    const vm = new VirtualMachine(image, {sourceFusion, preciseRootLiveness: true});
    vm.top.locals[0] = vm.heap.string('caller-root');
    vm.heap.threshold = 1;
    vm.run();
    assert(vm.heap.stats.collections > 0);
    vm.heap.collect();
    results.push({state: vm.state, instructions: vm.instructions, text: vm.heap.get(vm.returnValue).data});
    vm.stop();
  }
  assert.deepEqual(results[1], results[0]);
  assert.equal(results[1].text, 'caller-root');
});
