import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {compiledMemory, memoryMachine, captureBoundary, pinnedMemoryAssembly} from './support/snapshot-memory-fixtures.js';
import {stackSpan} from '../packages/runtime/src/execution/spans.js';

function snapshotSpans(snapshot) {
  return snapshot.frames.flatMap(frame => [...frame.locals, ...(frame.args ?? []), ...(frame.stack ?? [])])
    .concat(snapshot.stack ?? []).filter(value => value?.span && value.pointer);
}

function evaluationStack(snapshot) {
  return snapshot.engine === 'source' ? snapshot.stack : snapshot.frames.at(-1).stack;
}

function assertUnchanged(vm, before) {
  assert.equal(vm.frames, before.frames);
  assert.equal(vm.heap.records, before.records);
  assert.equal(vm.heap.handles, before.handles);
  assert.equal(vm.frameIndex, before.frameIndex);
  assert.equal(vm.instructions, before.instructions);
}

function liveState(vm) {
  return {frames: vm.frames, records: vm.heap.records, handles: vm.heap.handles,
    frameIndex: vm.frameIndex, instructions: vm.instructions};
}

for (const engine of ['source', 'cil']) {
  test(`T06 ${engine}: malformed memory on the evaluation stack rejects before replacement`, async () => {
    const artifact = compiledMemory();
    const original = memoryMachine(engine, artifact);
    const wire = await serializeSnapshot(original, captureBoundary(original));
    const fresh = memoryMachine(engine, artifact);
    const before = liveState(fresh);
    const corruptions = [
      (snapshot, span) => Object.freeze({...span, length: span.length + 100}),
      (snapshot, span) => Object.freeze({...span, readonly: 'false'}),
      (snapshot, span) => Object.freeze({...span, elementType: fresh.heap.methodTables.get('object')}),
      (snapshot, span) => Object.freeze({...span, pointer: Object.freeze({...span.pointer, frameId: snapshot.frameId + 1})}),
      (snapshot, span) => Object.freeze({...span, pointer: Object.freeze({...span.pointer, regionId: snapshot.memorySequence + 1})}),
      (snapshot, span) => Object.freeze({...span, pointer: Object.freeze({...span.pointer, readonly: true}), readonly: false}),
      (snapshot, span) => Object.freeze({...span.pointer, memoryPointer: false, kind: 'local', index: 0,
        frameId: snapshot.frameId + 1, baseType: null, path: Object.freeze([])})
    ];
    for (const corrupt of corruptions) {
      const snapshot = await deserializeSnapshot(fresh, wire);
      const span = snapshotSpans(snapshot).find(value => !value.readonly && value.length === 4);
      evaluationStack(snapshot).push(corrupt(snapshot, span));
      assert.throws(() => fresh.restore(snapshot), TypeError);
      assertUnchanged(fresh, before);
    }
  });

  test(`T06 ${engine}: region aliases, escaped spans and destination memory budgets reject atomically`, async () => {
    const artifact = compiledMemory();
    const original = memoryMachine(engine, artifact);
    const wire = await serializeSnapshot(original, captureBoundary(original));
    const fresh = memoryMachine(engine, artifact);
    const before = liveState(fresh);
    const aliased = await deserializeSnapshot(fresh, wire);
    const frame = aliased.frames.find(item => item.stackRegions?.size);
    const region = frame.stackRegions.values().next().value;
    frame.stackRegions.set(++aliased.memorySequence, {bytes: region.bytes});
    assert.throws(() => fresh.restore(aliased), /region alias/);
    assertUnchanged(fresh, before);
    const escaped = await deserializeSnapshot(fresh, wire);
    const span = snapshotSpans(escaped)[0];
    if (escaped.statics instanceof Map) escaped.statics.set('malformed', span);
    else escaped.statics.push(span);
    assert.throws(() => fresh.restore(escaped), /escaped to heap storage/);
    assertUnchanged(fresh, before);
    const limited = memoryMachine(engine, artifact, {maxStackMemoryBytes: 8});
    const limitedState = liveState(limited);
    await assert.rejects(restoreSerializedSnapshot(limited, wire), /stack memory budget/);
    assertUnchanged(limited, limitedState);
  });
}

test('T06 wire memory identities reject foreign VM addresses during export', async () => {
  const artifact = compiledMemory('Console.WriteLine("unused");');
  const original = memoryMachine('source', artifact);
  const foreign = memoryMachine('source', artifact);
  const saved = original.snapshot();
  saved.stack.push(stackSpan(foreign, 'int', 1));
  await assert.rejects(serializeSnapshot(original, saved), error => error.code === 'SNAPSHOT_OWNER');
});

test('T06 pinned portable replay rejects revoked handles and stale owners before restoring', async () => {
  const assembly = pinnedMemoryAssembly();
  const original = new CilVirtualMachine(assembly);
  const wire = await serializeSnapshot(original, captureBoundary(original));
  const fresh = new CilVirtualMachine(assembly);
  const before = liveState(fresh);
  for (const mutate of [
    (snapshot, lease) => { snapshot.heap.handles = snapshot.heap.handles.filter(([id]) => id !== lease.handle.id); },
    (snapshot, lease) => { lease.active = false; },
    (snapshot, lease) => { lease.owner = Object.freeze({...lease.owner, g: lease.owner.g + 1}); }
  ]) {
    const snapshot = await deserializeSnapshot(fresh, wire);
    const frame = snapshot.frames.find(item => item.pinLeases?.size);
    mutate(snapshot, frame.pinLeases.values().next().value);
    assert.throws(() => fresh.restore(snapshot), TypeError);
    assertUnchanged(fresh, before);
  }
});
