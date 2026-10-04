import {NullableValueStep} from './nullable-interior.js';
import {genericTypeParts, resolveExecutionField} from '@sharpforge/cil';
import {primitiveArrayConstructor} from './array-storage.js';
import {valueLayout} from './value-layout.js';
import {snapshotSequenceValue} from './snapshot-buffers.js';
import {snapshotInteger as integer, invalidSnapshot as fail} from './snapshot-validation-helpers.js';

export const sameSnapshotReference = (left, right) => left?.h === right?.h && left?.g === right?.g;

export function snapshotOwnedTable(context, table) {
  const registry = context.vm.heap.methodTables;
  if (!table || !Object.isFrozen(table) || table.registry !== registry || registry.tables.get(table.name) !== table) {
    fail('memory type ownership');
  }
  return table;
}

function declaredTable(context, type) {
  if (typeof type === 'string' && type.endsWith(' pinned')) type = type.slice(0, -7);
  try { return snapshotOwnedTable(context, context.vm.heap.methodTables.get(type)); }
  catch (error) { fail('managed address declared type: ' + error.message); }
}

function staticType(vm, index) {
  if (!vm.inspector) return vm.image.statics[index]?.type;
  const [token, owner] = typeof index === 'string' ? JSON.parse(index) : [index, null];
  if (!integer(token) || owner !== null && typeof owner !== 'string') fail('managed address static identity');
  const field = resolveExecutionField(vm.inspector, token, owner === null ? [] : genericTypeParts(owner).arguments);
  if (field.kind !== 'field' || !(field.flags & 0x10)) fail('managed address static field');
  return field.signature.type;
}

function frameType(vm, frame, pointer) {
  const optional = frame.varargs?.find(item => item.index === pointer.index);
  if (optional) return optional.type;
  return vm.inspector ? vm.slotType(frame, pointer.kind === 'arg', pointer.index)
    : vm.image.methods[frame.methodId]?.locals[pointer.index]?.type;
}

function managedAddress(context, pointer) {
  const {vm, snapshot, frames, referenceRecord} = context;
  let value, type, onePast = false, readonly = !!pointer.readonly;
  if (pointer.kind === 'string') {
    const record = referenceRecord(pointer.owner);
    type = vm.heap.methodTables.get('char');
    if (record.kind !== 'string' || typeof record.data !== 'string' || pointer.index > record.data.length ||
        pointer.readonly !== true || pointer.path.length || pointer.baseType !== type) fail('readonly string address');
    onePast = pointer.index === record.data.length;
    value = onePast ? undefined : record.data.charCodeAt(pointer.index);
  } else if (['field', 'box', 'array'].includes(pointer.kind)) {
    const record = referenceRecord(pointer.owner);
    if (!integer(pointer.index) || pointer.index > record.data.length ||
        pointer.kind === 'array' && record.kind !== 'array' || pointer.kind === 'box' && record.kind !== 'box') {
      fail('managed address owner or bounds');
    }
    onePast = pointer.index === record.data.length;
    if (onePast && (pointer.kind !== 'array' || pointer.path.length)) fail('managed address owner or bounds');
    const field = pointer.kind === 'field' ? record.methodTable.fields[pointer.index] : null;
    type = pointer.kind === 'array' ? record.methodTable.elementType : pointer.kind === 'box' ? record.methodTable
      : field?.storageType ?? field?.type;
    readonly ||= !!(field?.flags & 0x20);
    value = snapshotSequenceValue(record.data, pointer.index);
  } else if (pointer.kind === 'static') {
    const exists = snapshot.statics instanceof Map ? snapshot.statics.has(pointer.index)
      : integer(pointer.index) && pointer.index < snapshot.statics.length;
    if (!exists) fail('managed address static slot');
    try { type = staticType(vm, pointer.index); }
    catch (error) { fail('managed address static type: ' + error.message); }
    value = snapshot.statics instanceof Map ? snapshot.statics.get(pointer.index) : snapshot.statics[pointer.index];
  } else {
    const frame = frames.get(pointer.frameId);
    const slots = !frame ? null : pointer.kind === 'local' ? frame.locals
      : pointer.kind === 'arg' ? vm.inspector ? frame.args : frame.locals : null;
    if (!slots || !integer(pointer.index) || pointer.index >= slots.length) fail('managed address expired frame or slot');
    type = frameType(vm, frame, pointer);
    value = slots[pointer.index];
  }
  for (const index of pointer.path) {
    if (index === NullableValueStep) {
      const nullable = declaredTable(context, type);
      if (!nullable.flags.nullable || !nullable.nullableType || !Object.isFrozen(value) ||
          value?.nullableType !== nullable || value.hasValue !== true || value.value === null) fail('nullable interior address');
      type = snapshotOwnedTable(context, nullable.nullableType);
      value = value.value;
      continue;
    }
    if (!value?.valueType || !Array.isArray(value.fields) || !integer(index) || index >= value.fields.length) {
      fail('managed address interior path');
    }
    const table = snapshotOwnedTable(context, value.valueType), field = table.fields[index];
    if (!field) fail('managed address interior field');
    type = field.storageType ?? field.type;
    readonly ||= !!(field.flags & 0x20);
    value = value.fields[index];
  }
  return {type: declaredTable(context, type), value, readonly, onePast};
}

/** Resolve a location only against captured frames, regions, handles and object records. */
export function snapshotAddress(context, pointer) {
  const {vm, frames, referenceRecord} = context;
  if (pointer?.byref !== true || !Object.isFrozen(pointer) || pointer.vmOwner !== vm.snapshotOwner ||
      !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || pointer.path.length > 128 ||
      pointer.readonly !== undefined && typeof pointer.readonly !== 'boolean' ||
      !(integer(pointer.index) || pointer.kind === 'static' && typeof pointer.index === 'string' && pointer.index.length <= 16384)) {
    fail('managed address ownership');
  }
  if (pointer.baseType !== undefined) snapshotOwnedTable(context, pointer.baseType);
  if (!pointer.memoryPointer) return managedAddress(context, pointer);
  if (pointer.memoryPointer !== true || pointer.path.length || typeof pointer.readonly !== 'boolean') fail('raw address shape');
  const type = snapshotOwnedTable(context, pointer.baseType);
  let bytes;
  if (pointer.kind === 'reinterpret') {
    if (!pointer.source?.byref || pointer.source.memoryPointer || pointer.source === pointer) fail('reinterpretation source');
    const source = snapshotAddress(context, pointer.source), sourceType = snapshotOwnedTable(context, pointer.sourceType);
    if (source.onePast || source.type !== sourceType || source.readonly && !pointer.readonly ||
        pointer.owner !== pointer.source.owner || pointer.frameId !== pointer.source.frameId) fail('reinterpretation source type or owner');
    const layout = valueLayout(context.metadataVM, sourceType);
    if (layout.containsReferences || valueLayout(context.metadataVM, type).containsReferences) fail('reinterpretation references');
    bytes = layout.size;
  } else {
    const frame = frames.get(pointer.frameId);
    if (!frame) fail('raw address expired frame');
    if (pointer.kind === 'stack') {
      const region = frame.stackRegions?.get(pointer.regionId);
      if (!region || pointer.owner !== null) fail('raw address expired stack region or owner');
      bytes = region.bytes.byteLength;
    } else if (pointer.kind === 'pinned') {
      const lease = frame.pinLeases?.get(pointer.localIndex);
      if (!lease?.active || lease.id !== pointer.leaseId || !sameSnapshotReference(lease.owner, pointer.owner)) fail('raw address expired pin');
      const record = referenceRecord(pointer.owner);
      if (!primitiveArrayConstructor(record.methodTable.elementType)) fail('pinned reference storage');
      bytes = record.data.byteLength;
    } else fail('raw address region kind');
  }
  if (!integer(bytes) || !integer(pointer.index) || pointer.index > bytes) fail('raw address bounds');
  return {type, readonly: pointer.readonly, availableBytes: bytes - pointer.index};
}
