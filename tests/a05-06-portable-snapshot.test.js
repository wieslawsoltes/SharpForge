import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot}
  from '@sharpforge/runtime';
import {createMethodPointer, isMethodPointer} from '../packages/runtime/src/execution/method-pointers.js';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {instantiatedMethod} from '../packages/runtime/src/execution/generics.js';
import {captureGenericInstantiations} from '../packages/runtime/src/execution/generic-snapshot.js';
import {ownsHeapReference} from '../packages/runtime/src/execution/heap-reference.js';

const compiled = compileToIL('int n=1;while(n<6){n=n+1;}Console.WriteLine(n);');
assert(compiled.success, JSON.stringify(compiled.diagnostics));
const machine = (engine, options = {}) => engine === 'source' ? new VirtualMachine(compiled.image, options)
  : new CilVirtualMachine(compiled.assembly, options);

for (const engine of ['source', 'cil']) {
  for (const json of [false, true]) {
    test(`${engine}: ${json ? 'JSON' : 'structured clone'} snapshot resumes in a fresh owner`, async () => {
      const vm = machine(engine);
      vm.runSlice({instructionBudget: 7, timeBudgetMs: 1000});
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json});
      const fresh = machine(engine);
      await restoreSerializedSnapshot(fresh, json ? wire : structuredClone(wire));
      assert.notEqual(fresh.snapshotOwner, vm.snapshotOwner);
      assert.equal(fresh.top.id, vm.top.id);
      assert.equal(fresh.run().output, vm.run().output);
      assert.equal(fresh.output.join(''), '6\n');
    });
  }

  test(`${engine}: wire retains exact scalar values, cycles, aliases and typed payloads`, async () => {
    const vm = machine(engine), reference = vm.heap.allocate('array', 'double[]', new Float64Array(3));
    const data = vm.heap.get(reference).data;
    new BigUint64Array(data.buffer)[0] = 0x7ff800000000002an;
    data[1] = -0;
    vm.returnValue = reference;
    const saved = vm.snapshot(), shared = {integer: 18446744073709551615n, negativeZero: -0, infinity: Infinity, missing: undefined};
    shared.self = shared;
    saved.topology = [shared, shared];
    const fresh = machine(engine), restored = await deserializeSnapshot(fresh, await serializeSnapshot(vm, saved));
    assert.equal(restored.topology[0], restored.topology[1]);
    assert.equal(restored.topology[0].self, restored.topology[0]);
    assert.equal(restored.topology[0].integer, shared.integer);
    assert(Object.is(restored.topology[0].negativeZero, -0));
    assert.equal(restored.topology[0].infinity, Infinity);
    assert(Object.hasOwn(restored.topology[0], 'missing'));
    fresh.restore(restored);
    const actual = fresh.heap.get(fresh.returnValue).data;
    assert.equal(new BigUint64Array(actual.buffer)[0], 0x7ff800000000002an);
    assert(Object.is(actual[1], -0));
    assert(ownsHeapReference(fresh.heap, fresh.returnValue));
    assert(!ownsHeapReference(vm.heap, fresh.returnValue));
  });

  test(`${engine}: wrong code, ABI, host revision and malformed graphs reject before replacement`, async () => {
    const vm = machine(engine), wire = await serializeSnapshot(vm), fresh = machine(engine);
    const records = fresh.heap.records, frames = fresh.frames;
    for (const [property, value, code] of [
      ['schemaVersion', 999, 'SNAPSHOT_VERSION'], ['codeIdentity', 'mismatch', 'SNAPSHOT_CODE'],
      ['nativeIntBits', 16, 'SNAPSHOT_ABI'], ['hostRevision', 1, 'SNAPSHOT_HOST_REVISION']
    ]) {
      await assert.rejects(restoreSerializedSnapshot(fresh, {...wire, [property]: value}), error => error.code === code);
      assert.equal(fresh.frames, frames);
      assert.equal(fresh.heap.records, records);
    }
    const bad = structuredClone(wire);
    bad.graph.nodes.push({kind: 'executable'});
    await assert.rejects(restoreSerializedSnapshot(fresh, bad), error => error.code === 'SNAPSHOT_NODE');
    await assert.rejects(deserializeSnapshot(fresh, wire, {maxNodes: 1}), /oversized/);
    await assert.rejects(deserializeSnapshot(fresh, wire, {maxBytes: 1}), /limit/);
    assert.equal(fresh.frames, frames);
    assert.equal(fresh.heap.records, records);
  });

  test(`${engine}: a direct backing alias remains shared with its record across local and portable restore`, async () => {
    const vm = machine(engine), reference = vm.heap.array('int', 3);
    vm.heap.createHandle(reference);
    vm.heap.get(reference).data[0] = 17;
    vm.returnValue = vm.heap.get(reference).data.buffer;
    const saved = vm.snapshot();
    assert.equal(saved.returnValue, saved.heap.records[reference.h].data.buffer);
    assert.notEqual(saved.returnValue, vm.returnValue);
    const fresh = machine(engine);
    await restoreSerializedSnapshot(fresh, await serializeSnapshot(vm, saved));
    assert.equal(fresh.returnValue, fresh.heap.records[reference.h].data.buffer);
    vm.restore(saved);
    assert.equal(vm.returnValue, vm.heap.get(reference).data.buffer);
    assert.equal(new Int32Array(vm.returnValue)[0], 17);
  });
}

test('portable local addresses and issued function pointers are rebound to the receiving VM', async () => {
  const vm = machine('cil');
  assert(vm.top.locals.length > 0);
  vm.top.locals[0] = 123;
  vm.returnValue = vm.address('local', 0);
  const fresh = machine('cil');
  await restoreSerializedSnapshot(fresh, await serializeSnapshot(vm));
  assert.equal(fresh.returnValue.vmOwner, fresh.snapshotOwner);
  assert.equal(fresh.dereference(fresh.returnValue), 123);
  vm.returnValue = createMethodPointer(vm, vm.top.method.token);
  await restoreSerializedSnapshot(fresh, await serializeSnapshot(vm));
  assert(isMethodPointer(fresh, fresh.returnValue));
  assert(!isMethodPointer(vm, fresh.returnValue));
});

test('portable snapshots reject functions, unissued refs and accessors without invoking them', async () => {
  const vm = machine('source'), saved = vm.snapshot();
  saved.unsupported = () => 0;
  await assert.rejects(serializeSnapshot(vm, saved), error => error.code === 'SNAPSHOT_HOST_VALUE');
  const reference = vm.heap.string('owned');
  const invalid = vm.snapshot();
  invalid.returnValue = Object.freeze({h: reference.h, g: reference.g});
  await assert.rejects(serializeSnapshot(vm, invalid), /ownership/);
  let accessed = false;
  const payload = Object.defineProperty({}, 'format', {enumerable: true, get() { accessed = true; return ''; }});
  await assert.rejects(deserializeSnapshot(vm, payload), error => error.code === 'SNAPSHOT_JSON');
  assert.equal(accessed, false);
});

test('portable generic calls restore closed cache keys and canonical IL bodies', async () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer.op('ldc.i4', 42)
      .op('call', context.methodSpec(context.methods.get('Program.Identity'), ['int'])).op('ret')},
    {name: 'Identity', result: '!!0', parameters: ['!!0'], genericParameters: [{}],
      body: writer => writer.op('ldarg.0').op('ret')}
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
  assert.equal(vm.frames.length, 2);
  const local = vm.snapshot(), capturedMethod = vm.top.method;
  vm.restore(local);
  assert.equal(vm.top.method, capturedMethod);
  assert.equal(instantiatedMethod(vm, capturedMethod.token, null, ['int']), capturedMethod);
  const corrupted = vm.snapshot();
  corrupted.frames.at(-1).method = {...capturedMethod, maxStack: capturedMethod.maxStack + 1};
  assert.throws(() => vm.restore(corrupted), /method execution metadata differs/);
  assert.equal(vm.top.method, capturedMethod);
  const keys = captureGenericInstantiations(vm), fresh = new CilVirtualMachine(bytes);
  await restoreSerializedSnapshot(fresh, await serializeSnapshot(vm, vm.snapshot(), {json: true}));
  assert.deepEqual(captureGenericInstantiations(fresh), keys);
  assert.equal(fresh.top.method.instructions, fresh.inspector.getMethod(fresh.top.method.token).instructions);
  assert.equal(fresh.top.method, instantiatedMethod(fresh, fresh.top.method.token, null, ['int']));
  assert.equal(fresh.run().returnValue, 42);
});
