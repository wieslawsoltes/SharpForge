import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {
  VirtualMachine, CilVirtualMachine, serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot
} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {captureGenericInstantiations} from '../packages/runtime/src/execution/generics.js';

const source = 'int x=1;while(x<5){x=x+1;}Console.WriteLine(x);';
function compiled(text = source) {
  const result = compileToIL(text);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
function machine(engine, artifact, options = {}) {
  return engine === 'source' ? new VirtualMachine(artifact.image, options)
    : new CilVirtualMachine(artifact.assembly, options);
}

for (const engine of ['source', 'cil']) {
  for (const json of [true, false]) {
    test(`portable ${engine} snapshot resumes in a fresh VM through ${json ? 'JSON' : 'structured clone'}`, async () => {
      const artifact = compiled();
      const original = machine(engine, artifact);
      original.runSlice({instructionBudget: 9, timeBudgetMs: 100});
      const captured = original.snapshot();
      const wire = await serializeSnapshot(original, captured, {json});
      const fresh = machine(engine, artifact);
      await restoreSerializedSnapshot(fresh, json ? wire : structuredClone(wire));
      assert.notEqual(fresh.snapshotOwner, original.snapshotOwner);
      assert.equal(fresh.top.id, original.top.id);
      assert.equal(fresh.frameIndex.get(fresh.top.id), fresh.top);
      assert.equal(fresh.stackBudget.frames.size, original.stackBudget.frames.size);
      const expected = original.run();
      if (fresh.state === 'paused') fresh.state = 'running';
      const result = fresh.run();
      assert.equal(result.state, expected.state, result.fault?.stack);
      assert.equal(result.output, expected.output);
      assert.equal(result.output, '5\n');
    });
  }

  test(`portable ${engine} snapshots retain typed heap bytes, scalar widths and graph aliases`, async () => {
    const artifact = compiled();
    const original = machine(engine, artifact);
    const vector = original.heap.array('double', 3);
    const words = new BigUint64Array(original.heap.get(vector).data.buffer);
    words[0] = 0x7ff800000000002an;
    original.heap.writeData(vector, 1, -0);
    original.returnValue = vector;
    const saved = original.snapshot();
    const shared = {integer: 18446744073709551615n, missing: undefined, infinity: Infinity};
    shared.self = shared;
    saved.topology = [shared, shared];
    const wire = await serializeSnapshot(original, saved);
    const fresh = machine(engine, artifact);
    const restored = await deserializeSnapshot(fresh, wire);
    assert.equal(restored.topology[0], restored.topology[1]);
    assert.equal(restored.topology[0].self, restored.topology[0]);
    assert.equal(restored.topology[0].integer, 18446744073709551615n);
    assert.equal(restored.topology[0].infinity, Infinity);
    assert(Object.hasOwn(restored.topology[0], 'missing'));
    fresh.restore(restored);
    const data = fresh.heap.get(fresh.returnValue).data;
    assert.equal(new BigUint64Array(data.buffer)[0], 0x7ff800000000002an);
    assert(Object.is(data[1], -0));
    assert.equal(fresh.returnValue.heapOwner, fresh.heap.handleOwner);
    assert.throws(() => original.heap.get(fresh.returnValue));
  });

  test(`portable ${engine} snapshots reject code/ABI/schema mismatches without replacing state`, async () => {
    const artifact = compiled();
    const original = machine(engine, artifact, {nativeIntBits: 32});
    const wire = await serializeSnapshot(original);
    const fresh = machine(engine, artifact, {nativeIntBits: 32});
    const frames = fresh.frames, records = fresh.heap.records, cache = fresh.genericInstantiations;
    for (const [property, value, code] of [
      ['schemaVersion', 0, 'SNAPSHOT_VERSION'], ['codeIdentity', 'wrong', 'SNAPSHOT_CODE'],
      ['nativeIntBits', 64, 'SNAPSHOT_ABI'], ['hostRevision', 1, 'SNAPSHOT_HOST_REVISION']
    ]) {
      await assert.rejects(restoreSerializedSnapshot(fresh, {...wire, [property]: value}), error => error.code === code);
      assert.equal(fresh.frames, frames);
      assert.equal(fresh.heap.records, records);
      assert.equal(fresh.genericInstantiations, cache);
    }
    await assert.rejects(deserializeSnapshot(fresh, wire, {maxNodes: 1}), /oversized/);
    const malformed = structuredClone(wire);
    malformed.graph.nodes.push({kind: 'unknown'});
    await assert.rejects(restoreSerializedSnapshot(fresh, malformed), /Unknown snapshot node/);
    assert.equal(fresh.frames, frames);
    assert.equal(fresh.genericInstantiations, cache);
  });
}

test('portable generic frames resolve canonical bodies and retain cache keys in a new CIL VM', async () => {
  const bytes = controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', maxStack: 1, body(writer, context) {
      writer.op('ldc.i4', 42).op('call', context.methodSpec(context.methods.get('Program.Identity'), [[8]])).op('ret');
    }},
    {name: 'Identity', parameters: ['object'], result: 'object', genericParameters: [{}],
      signature: Uint8Array.from([0x10, 1, 1, 0x1e, 0, 0x1e, 0]),
      body: writer => writer.op('ldarg.0').op('ret')}
  ]}]);
  const original = new CilVirtualMachine(bytes);
  original.runSlice({instructionBudget: 2, timeBudgetMs: 100});
  assert.equal(original.frames.length, 2);
  const keys = captureGenericInstantiations(original);
  const fresh = new CilVirtualMachine(bytes);
  await restoreSerializedSnapshot(fresh, await serializeSnapshot(original, original.snapshot(), {json: true}));
  assert.deepEqual(captureGenericInstantiations(fresh), keys);
  assert.equal(fresh.top.method.instructions, fresh.inspector.getMethod(fresh.top.method.token).instructions);
  assert.equal(fresh.run().returnValue, 42);
});

test('portable graphs reject executable host values and accessors', async () => {
  const vm = machine('source', compiled());
  const saved = vm.snapshot();
  saved.host = () => 0;
  await assert.rejects(serializeSnapshot(vm, saved), error => error.code === 'SNAPSHOT_HOST_VALUE');
  let invoked = false;
  const payload = Object.defineProperty({}, 'format', {enumerable: true, get() { invoked = true; return ''; }});
  await assert.rejects(deserializeSnapshot(vm, payload), error => error.code === 'SNAPSHOT_JSON');
  assert.equal(invoked, false);
});
