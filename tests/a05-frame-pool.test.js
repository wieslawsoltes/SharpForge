import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {createManagedAddress, dereferenceManagedAddress} from '../packages/runtime/src/execution/managed-address.js';
import {managedFixture} from './managed-fixtures.js';

const program = 'class Program { static int Twice(int x) { return x * 2; } static int Main() { int sum = 0; for (int i = 1; i <= 20; i++) sum += Twice(i); return sum; } }';
function make(engine, options = {}, source = program) {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return engine === 'cil' ? new CilVirtualMachine(result.assembly, options)
    : new VirtualMachine(engine === 'reload' ? result.assembly : result.image, options);
}
function entry(vm) { return vm.inspector ? vm.top.method.token : vm.top.methodId; }
function runAgain(vm, method) { vm.state = 'running'; vm.call(method, []); return vm.run(); }

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: warmed calls reuse owned storage with fresh frame identities`, () => {
    const vm = make(engine), method = entry(vm), oldFrame = vm.top, oldId = oldFrame.id;
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 420);
    const warm = framePoolStatistics(vm);
    assert(Object.isFrozen(warm));
    assert(warm.reused >= 19);
    assert.equal(oldFrame.id, undefined);
    vm.state = 'running';
    vm.call(method, []);
    assert.equal(vm.top, oldFrame);
    assert(vm.top.id > oldId);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    const next = framePoolStatistics(vm);
    assert.equal(next.framesAllocated, warm.framesAllocated);
    assert.equal(next.arraysAllocated, warm.arraysAllocated);
    assert.equal(vm.returnValue, 420);
    vm.stop();
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
  });

  test(`${engine}: disabling retention and small budgets preserve output`, () => {
    for (const options of [{framePooling: false}, {framePoolBytes: 0}, {framePoolBytes: 256}]) {
      const vm = make(engine, options);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.returnValue, 420);
      const stats = framePoolStatistics(vm);
      assert(stats.retainedBytes <= (options.framePoolBytes ?? 0));
      if (options.framePooling === false || options.framePoolBytes === 0) assert.equal(stats.reused, 0);
      vm.stop();
    }
  });

  test(`${engine}: snapshot replay drops derived pools only after accepted restore`, () => {
    const vm = make(engine), saved = vm.snapshot();
    vm.run();
    const before = framePoolStatistics(vm);
    assert.throws(() => vm.restore({...saved, schemaVersion: 999}), /schema version/);
    assert.deepEqual(framePoolStatistics(vm), before);
    vm.restore(saved);
    assert.equal(framePoolStatistics(vm).framesAllocated, 0);
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 420);
    vm.stop();
  });

  test(`${engine}: recursion and finally returns preserve distinct live storage`, () => {
    const source = 'class Program { static int Sum(int n) { if (n == 0) return 0; try { return n + Sum(n - 1); } finally { Console.WriteLine(n); } } static int Main() { return Sum(8); } }';
    const vm = make(engine, {}, source), method = entry(vm);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 36);
    assert.equal(vm.output.join(''), '1\n2\n3\n4\n5\n6\n7\n8\n');
    const warm = framePoolStatistics(vm);
    assert(warm.framesAllocated >= 10);
    runAgain(vm, method);
    assert.equal(vm.returnValue, 36);
    assert.equal(framePoolStatistics(vm).framesAllocated, warm.framesAllocated);
    vm.stop();
  });
}

test('CIL: a stale managed address cannot bind to a reused frame', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.op('ldc.i4.7').op('stloc.0').op('ldloc.0').op('ret')}]}));
  const frame = vm.top, method = entry(vm);
  const address = createManagedAddress(vm, 'local', 0);
  assert.equal(dereferenceManagedAddress(vm, address), 0);
  assert.equal(vm.run().returnValue, 7);
  vm.state = 'running';
  vm.call(method, []);
  assert.equal(vm.top, frame);
  assert.throws(() => dereferenceManagedAddress(vm, address), /outlived its frame/);
  assert.equal(vm.run().returnValue, 7);
});

test('invalid frame budgets fail before admission', () => {
  for (const framePoolBytes of [-1, NaN, 1.5, '1024']) {
    assert.throws(() => make('cil', {framePoolBytes}), /Invalid framePoolBytes/);
    assert.throws(() => make('source', {framePoolBytes}), /Invalid framePoolBytes/);
  }
});
