import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {FramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {copyFrames} from '../packages/runtime/src/execution/execution-copy.js';

function poolFixture(engine) {
  const method = engine === 'cil'
    ? {signature: {isStatic: true, parameters: ['object']}, locals: ['object'], maxStack: 2}
    : {isStatic: true, parameters: [], locals: [{type: 'object'}], handlers: [],
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])};
  const vm = {options: {}, ...(engine === 'cil' ? {inspector: {}} : {image: {constants: [null]}})};
  return {method, pool: new FramePool(vm)};
}

for (const engine of ['source', 'cil']) {
  test(`Frame pool ${engine}: late fields clear on every reuse without changing inherited properties or snapshots`, () => {
    const {method, pool} = poolFixture(engine);
    const frame = pool.acquire(method);
    const retained = {args: frame.args, locals: frame.locals, stack: frame.stack,
      caught: frame.caught, unwinds: frame.unwinds};
    const inherited = Object.freeze({hostAnnotation: {name: 'shared annotation'}});
    Object.setPrototypeOf(frame, inherited);
    frame.method = engine === 'cil' ? method : undefined;
    frame.methodId = engine === 'source' ? 0 : undefined;
    frame.locals[0] = Object.freeze({h: 4, g: 2});
    const snapshot = copyFrames([frame]);
    pool.retire(frame);
    pool.flush();

    const reused = pool.acquire(method);
    assert.equal(reused, frame);
    const reference = Object.freeze({h: 5, g: 3});
    reused.args.push(reference);
    reused.locals[0] = reference;
    reused.stack.push(reference);
    reused.caught.push({fault: {reference}});
    reused.unwinds.push({value: reference});
    reused.delegateContinuation = {args: [reference]};
    reused.exceptionEventContinuation = {fault: {reference}, handlers: [reference]};
    reused.debuggerExtension = {reference};
    pool.retire(reused);
    assert.equal(reused.debuggerExtension.reference, reference, 'Retirement defers clearing until callbacks finish');
    pool.flush();

    for (const [name, values] of Object.entries(retained)) {
      assert.equal(reused[name], values, `${name} array is reused`);
      assert.equal(values.length, 0, `${name} drops its old references`);
    }
    for (const name of ['delegateContinuation', 'exceptionEventContinuation', 'debuggerExtension']) {
      assert.equal(reused[name], undefined, `${name} was added after the first reuse`);
    }
    assert.equal(Object.hasOwn(reused, 'hostAnnotation'), false);
    assert.equal(reused.hostAnnotation, inherited.hostAnnotation);
    assert.deepEqual(snapshot[0].locals[0], {h: 4, g: 2});
    assert.notEqual(snapshot[0].locals, reused.locals);
  });
}

const source = `class Program {
  static int Use(int value) { int[] values = new int[8]; values[0] = value; return values[0] + 1; }
  static void Main() { int total = 0; for (int i = 0; i < 24; i++) total += Use(i); System.Console.WriteLine(total); }
}`;

for (const engine of ['source', 'cil']) {
  test(`Frame pool ${engine}: repeated calls release managed arrays and preserve saved execution`, () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      vm.heap.collect();
      const baseline = vm.heap.stats.liveObjects;
      const snapshot = vm.snapshot();
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '300\n');
      assert(vm.heap.stats.allocations >= 24, 'The program must actually allocate the temporary managed arrays');
      const cachedFrames = [...vm.framePool.cached];
      assert(cachedFrames.length >= 2, 'Main and Use leave reusable frame storage');
      for (const frame of cachedFrames) {
        assert.deepEqual(frame.locals, []);
        assert.deepEqual(frame.args, []);
        assert.deepEqual(frame.stack, []);
      }
      vm.heap.collect();
      assert.equal(vm.heap.stats.liveObjects, baseline);
      const pool = vm.framePool;
      vm.restore(snapshot);
      assert.notEqual(vm.framePool, pool, 'Restore discards derived cached frame storage');
      assert(!cachedFrames.includes(vm.top));
      vm.state = 'running';
      const replay = vm.run();
      assert.equal(replay.state, 'terminated', replay.fault?.message);
      assert.equal(replay.output, result.output);
      vm.heap.collect();
      assert.equal(vm.heap.stats.liveObjects, baseline);
    } finally { vm.stop(); }
  });
}
