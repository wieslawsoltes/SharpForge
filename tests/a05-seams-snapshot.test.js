import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {assertSnapshotFields, copyExecution, snapshotSchemas, snapshotSchemaVersion} from '../packages/runtime/src/snapshot.js';

const source = 'int x=1;Console.WriteLine(x);x=2;Console.WriteLine(x);';
const make = engine => {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return engine === 'source' ? new VirtualMachine(result.image) : new CilVirtualMachine(result.assembly);
};

for (const engine of ['source', 'cil']) {
  test(`${engine}: snapshot schema classifies every VM field and rejects omissions`, () => {
    const vm = make(engine);
    const registered = new Set([...snapshotSchemas[engine].fields.map(field => field.name), ...Object.keys(snapshotSchemas[engine].excluded)]);
    assert.deepEqual(Object.keys(vm).filter(key => !registered.has(key)), []);
    assert.equal(assertSnapshotFields(vm, engine), snapshotSchemas[engine]);
    vm.unregisteredExecutionState = [];
    assert.throws(() => assertSnapshotFields(vm, engine), /unregisteredExecutionState/);
    assert.throws(() => vm.snapshot(), /unregisteredExecutionState/);
  });

  test(`${engine}: versioned snapshots replay independently and retain host callbacks`, () => {
    const vm = make(engine);
    vm.runSlice({instructionBudget: 5, timeBudgetMs: 1000});
    const notifyWrite = () => {};
    vm.notifyWrite = notifyWrite;
    const saved = vm.snapshot();
    assert.equal(saved.schemaVersion, snapshotSchemaVersion);
    assert.equal(saved.engine, engine);
    const expected = vm.run().output;
    const callback = () => {};
    vm.onOutput = callback;
    for (let i = 0; i < 2; i++) {
      vm.restore(saved);
      assert.equal(vm.onOutput, callback);
      assert.equal(vm.notifyWrite, notifyWrite);
      assert.equal(vm.run().output, expected);
    }
  });

  test(`${engine}: invalid version, foreign owner and missing state fail before mutation`, () => {
    const vm = make(engine), saved = vm.snapshot();
    vm.run();
    const output = vm.output.join(''), instructions = vm.instructions;
    assert.throws(() => vm.restore({...saved, schemaVersion: 999}), /schema version/);
    assert.throws(() => vm.restore({...saved, engine: 'other'}), /schema version/);
    assert.throws(() => vm.restore(make(engine).snapshot()), /another/);
    const malformed = {...saved}; delete malformed.frames;
    assert.throws(() => vm.restore(malformed), /missing 'frames'/);
    assert.equal(vm.instructions, instructions);
    assert.equal(vm.output.join(''), output);
  });

  test(`${engine}: snapshot fault aliases and optional debugger state survive restore`, () => {
    const vm = make(engine), fault = new ManagedFault('Exception', 'saved fault');
    vm.pendingFault = fault; vm.fault = fault; vm.top.exception = fault;
    vm.pendingWrite = {kind: 'local', value: 17};
    const saved = vm.snapshot();
    vm.pendingWrite.value = 99;
    vm.restore(saved);
    assert.equal(vm.pendingFault, vm.fault);
    assert.equal(vm.top.exception, vm.fault);
    assert.notEqual(vm.fault, fault);
    assert.equal(vm.pendingWrite.value, 17);
    vm.pendingWrite.value = 123;
    assert.equal(saved.pendingWrite.value, 17);
  });
}

test('execution copying preserves cycles, collection aliases, views and exact numeric values', () => {
  const fault = new ManagedFault('OverflowException', 'range');
  const bytes = new Uint8Array([1, 2, 3]);
  const graph = {fault, map: Object.freeze(new Map([['fault', fault]])), set: new Set([fault]), bytes, view: new DataView(bytes.buffer), exact: 9223372036854775807n, zero: -0};
  graph.self = graph;
  const copied = copyExecution(graph);
  assert.equal(copied.self, copied);
  assert.equal(copied.map.get('fault'), copied.fault);
  assert(copied.set.has(copied.fault));
  assert.equal(copied.bytes.buffer, copied.view.buffer);
  assert.notEqual(copied.bytes.buffer, bytes.buffer);
  assert.equal(copied.exact, graph.exact);
  assert(Object.is(copied.zero, -0));
  copied.bytes[0] = 9;
  assert.equal(bytes[0], 1);
});

test('execution copying clones frozen buffers and views while retaining shared storage', () => {
  const buffer = Object.freeze(new ArrayBuffer(8));
  const view = Object.freeze(new DataView(buffer));
  view.setInt32(0, 42);
  const copy = copyExecution({buffer, view, bytes: new Uint8Array(buffer)});
  assert.notEqual(copy.buffer, buffer);
  assert.notEqual(copy.view, view);
  assert.equal(copy.view.buffer, copy.buffer);
  assert.equal(copy.bytes.buffer, copy.buffer);
  view.setInt32(0, 99);
  assert.equal(copy.view.getInt32(0), 42);
});
