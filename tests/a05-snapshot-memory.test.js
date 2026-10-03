import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, serializeSnapshot, deserializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {compiledMemory, memoryMachine, captureBoundary, memoryValues, pinnedMemoryAssembly} from './support/snapshot-memory-fixtures.js';
import {valueFixture} from './a05-03-fixtures.js';
import {spanGet, spanSet} from '../packages/runtime/src/execution/spans.js';
import {readMemory, writeMemory} from '../packages/runtime/src/execution/raw-memory.js';
import {livePinCount} from '../packages/runtime/src/execution/pinned.js';
import {nullableValue, boxValue, unboxValue, valueDefault} from '../packages/runtime/src/execution/value-types.js';
import {address, dereference} from '../packages/runtime/src/execution/managed-pointers.js';

for (const engine of ['source', 'reload', 'cil']) {
  for (const json of [false, true]) {
    test(`T06 ${engine}: live stack spans replay in a fresh VM through ${json ? 'JSON' : 'structured clone'}`, async () => {
      const artifact = compiledMemory();
      const original = memoryMachine(engine, artifact);
      const captured = captureBoundary(original);
      const sourceSpan = memoryValues(original, value => value?.span && !value.readonly && value.length === 4)[0];
      assert(sourceSpan);
      const wire = await serializeSnapshot(original, captured, {json});
      spanSet(original, sourceSpan, 1, -999);
      original.stop();
      original.heap.collect();
      for (let replay = 0; replay < 2; replay++) {
        const fresh = memoryMachine(engine, artifact);
        await restoreSerializedSnapshot(fresh, json ? wire : structuredClone(wire));
        const spans = memoryValues(fresh, value => value?.span);
        const mutable = spans.find(value => !value.readonly && value.length === 4);
        const readonly = spans.find(value => value.readonly && value.length === 4);
        const slice = spans.find(value => value.length === 2);
        assert(mutable && readonly && slice);
        assert.equal(mutable.vmOwner, fresh.snapshotOwner);
        assert.equal(mutable.elementType, fresh.heap.methodTables.get('int'));
        assert.equal(mutable.pointer.vmOwner, fresh.snapshotOwner);
        assert.equal(mutable.pointer.regionId, slice.pointer.regionId);
        assert.equal(mutable.pointer.frameId, readonly.pointer.frameId);
        assert.equal(spanGet(fresh, mutable, 1), 20);
        assert.equal(spanGet(fresh, readonly, 1), 20);
        assert.throws(() => spanSet(fresh, readonly, 0, 4), {name: 'InvalidProgramException'});
        assert.throws(() => spanGet(fresh, sourceSpan, 0), {name: 'InvalidProgramException'});
        fresh.heap.collect();
        assert.equal(fresh.run().output, 'capture\n77\n20\n0\n');
        assert.equal(fresh.state, 'terminated', fresh.fault?.stack);
        assert.throws(() => spanGet(fresh, mutable, 0), {name: 'InvalidProgramException'});
      }
    });
  }
}

test('T06 CIL: transferred pins retain array owners and revoke native pointers after the fixed scope', async () => {
  const assembly = pinnedMemoryAssembly();
  const original = new CilVirtualMachine(assembly);
  const captured = captureBoundary(original);
  const oldPointer = memoryValues(original, value => value?.memoryPointer && value.kind === 'pinned')[0];
  assert(oldPointer);
  assert.equal(livePinCount(original), 1);
  const wire = await serializeSnapshot(original, captured);
  writeMemory(original, oldPointer, 99, 'int');
  original.stop();
  original.heap.collect();
  const fresh = new CilVirtualMachine(assembly);
  await restoreSerializedSnapshot(fresh, structuredClone(wire));
  const pointer = memoryValues(fresh, value => value?.memoryPointer && value.kind === 'pinned')[0];
  assert.equal(pointer.owner.heapOwner, fresh.heap.handleOwner);
  assert.equal(livePinCount(fresh), 1);
  fresh.heap.collect();
  assert.equal(readMemory(fresh, pointer, 'int'), 0);
  assert.equal(fresh.run().output, 'capture\n7\n');
  assert.equal(livePinCount(fresh), 0);
  assert.throws(() => readMemory(fresh, pointer, 'int'), {name: 'InvalidProgramException'});
  assert.throws(() => readMemory(fresh, oldPointer, 'int'), {name: 'InvalidProgramException'});
});

test('T06 CIL: nested struct copies and Nullable boxes preserve destination type identities', async () => {
  const assembly = valueFixture([{name: 'Main', locals: ['Fixture.Outer', 'Fixture.Outer'], body: writer => writer.op('ret')}]);
  const original = new CilVirtualMachine(assembly);
  const table = original.typeSystem.table('Fixture.Outer');
  original.top.locals[0] = valueDefault(original, table);
  original.top.locals[1] = valueDefault(original, table);
  const location = address(original, 'local', 0, null, {type: table});
  const number = address(original, 'field', 0, address(original, 'field', 0, location));
  dereference(original, number, true, 12);
  const text = original.heap.string('retained');
  const textSlot = address(original, 'field', 1, address(original, 'field', 0, location));
  dereference(original, textSlot, true, text);
  // Return storage is a root and can hold an immutable value pending a caller handoff.
  original.returnValue = nullableValue(original, 'int?', 42);
  const saved = original.snapshot();
  const wire = await serializeSnapshot(original, saved, {json: true});
  dereference(original, number, true, 999);
  original.stop();
  original.heap.collect();
  const fresh = new CilVirtualMachine(assembly);
  const restored = await deserializeSnapshot(fresh, wire);
  fresh.restore(restored);
  const first = fresh.top.locals[0];
  assert.equal(first.valueType, fresh.typeSystem.table('Fixture.Outer'));
  assert.equal(first.fields[0].fields[0], 12);
  assert.equal(fresh.top.locals[1].fields[0].fields[0], 0);
  fresh.heap.collect();
  assert.equal(fresh.heap.get(first.fields[0].fields[1]).data, 'retained');
  assert.equal(fresh.returnValue.nullableType, fresh.heap.methodTables.get('int?'));
  const boxed = boxValue(fresh, fresh.returnValue, 'int?');
  assert.equal(unboxValue(fresh, boxed, 'int'), 42);
  const slot = address(fresh, 'local', 0, null, {type: first.valueType});
  dereference(fresh, address(fresh, 'field', 0, address(fresh, 'field', 0, slot)), true, -1);
  assert.equal(fresh.top.locals[1].fields[0].fields[0], 0);
  assert.equal(restored.frames[0].locals[0].fields[0].fields[0], 12);
});
