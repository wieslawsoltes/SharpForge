import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, Binary, verifyImage, verifiedSourceStackBound} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, prepareExecution, invalidateExecutionCode, executionCodeStatistics} from '@sharpforge/runtime';

function method(name, code = null) {
  return {name, qualifiedName: name, isAbstract: code === null, isVirtual: code === null, isStatic: code !== null,
    parameters: [], returnType: 'int', locals: [], handlers: [], code: Int32Array.from(code ?? [])};
}

function abstractFixture() {
  const image = {formatVersion: FORMAT_VERSION, entryPoint: 1, constants: [40, 2], types: [], statics: [], sequencePoints: [],
    methods: [method('First.Abstract'), method('Main', [Op.CONST, 0, 0, Op.RET, 0, 0]), method('Second.Abstract'),
      method('Add', [Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0]), method('Last.Abstract')]};
  for (let index = 0; index < image.methods.length; index++) image.methods[index].id = index;
  return image;
}

test('abstract declarations before and between concrete methods preserve authentic proof positions', () => {
  const image = abstractFixture();
  assert.deepEqual(verifyImage(image, {stackBounds: true}), []);
  assert.deepEqual(verifiedSourceStackBound(image, image.methods[1]), {peak: 1});
  assert.deepEqual(verifiedSourceStackBound(image, image.methods[3]), {peak: 2});
  for (const index of [0, 2, 4]) assert.equal(verifiedSourceStackBound(image, image.methods[index]), null);
  assert.equal(verifiedSourceStackBound({...image}, image.methods[1]), null, 'another image cannot borrow a proof');
});

test('proofs after abstract declarations still reject changed bodies, method slots and forged identities', () => {
  const image = abstractFixture();
  const main = image.methods[1];
  const add = image.methods[3];
  assert.deepEqual(verifyImage(image, {stackBounds: true}), []);
  assert.equal(verifiedSourceStackBound(image, {...main}), null);
  main.code[1] = 1;
  assert.equal(verifiedSourceStackBound(image, main), null, 'in-place operand changes invalidate the original proof');
  main.code[1] = 0;
  assert.deepEqual(verifiedSourceStackBound(image, main), {peak: 1});
  [image.methods[1], image.methods[3]] = [add, main];
  assert.equal(verifiedSourceStackBound(image, main), null);
  assert.equal(verifiedSourceStackBound(image, add), null);
  assert.deepEqual(verifyImage(image, {stackBounds: true}), []);
  assert.deepEqual(verifiedSourceStackBound(image, main), {peak: 1});
  assert.deepEqual(verifiedSourceStackBound(image, add), {peak: 2});
  image.methods[3] = {...main};
  assert.equal(verifiedSourceStackBound(image, main), null, 'proof ownership follows the actual method object');
  assert.equal(verifiedSourceStackBound(image, image.methods[3]), null);
});

const interfaceSource = `using System;
interface Counter { int First(); int Second(); }
class Concrete : Counter {
  public int First() { return 20; }
  public int Second() { return 22; }
}
class Program {
  static int Read(Counter counter) { return counter.First() + counter.Second(); }
  static void Main() { Counter counter = new Concrete(); Console.WriteLine(Read(counter)); }
}`;

for (const engine of ['source', 'reloaded source']) {
  test(`${engine}: interface stack admission and snapshot replay survive explicit code invalidation`, () => {
    const compiled = compileToIL(interfaceSource, {pipeline: 'bound'});
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const image = engine === 'source' ? compiled.image : loadAssembly(compiled.assembly);
    assert.equal(image.methods.filter(value => value.isAbstract).length, 2);
    const vm = new VirtualMachine(image, {maxStackBytes: 1024 * 1024, sourceFusion: true});
    try {
      const snapshot = vm.snapshot();
      const prepared = prepareExecution(vm);
      assert.equal(prepared.status, 'prepared');
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      const instructions = vm.instructions;
      const invalidatedEpoch = invalidateExecutionCode(vm, 'abstract-stack-proof-regression');
      assert.equal(prepareExecution(vm).statistics.epoch, invalidatedEpoch);
      assert.equal(vm.instructions, instructions);
      const first = vm.run();
      assert.equal(first.state, 'terminated', first.fault?.message);
      assert.equal(first.output, '42\n');
      const completedEpoch = executionCodeStatistics(vm).epoch;
      vm.restore(snapshot);
      assert.equal(vm.instructions, 0);
      assert.ok(executionCodeStatistics(vm).epoch > completedEpoch);
      assert.equal(prepareExecution(vm).status, 'prepared');
      const replay = vm.run();
      assert.equal(replay.state, 'terminated', replay.fault?.message);
      assert.equal(replay.output, first.output);
      assert.equal(replay.stats.instructions, first.stats.instructions);
    } finally { vm.stop(); }
  });
}
