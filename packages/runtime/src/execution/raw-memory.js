import {ManagedFault} from '../heap.js';
import {stackRegion, memoryPointer} from './stack-memory.js';
import {pinnedRecord} from './pinned.js';
import {arrayInteger} from './array-limits.js';
import {rawArrayBytes, arrayElementBytes} from './array-storage.js';
import {valueLayout} from './value-layout.js';
import {sameMemoryAllocation} from './memory-allocation-identity.js';
import {createValue, createValueFromFields, isAggregateType} from './value-types.js';
import {number, storage} from './numeric-ops.js';
import {scalarAccess} from './scalar-bytes.js';
import {hasExplicitLayout} from './explicit-layout.js';
import {explicitValueFromBytes} from './explicit-values.js';

function checkedBytes(pointer, bytes) {
  if (pointer.index > bytes.length) throw new ManagedFault('IndexOutOfRangeException', 'Memory address exceeds its allocation');
  return bytes;
}

export function validateMemoryPointer(vm, pointer, {write = false} = {}) {
  if (pointer?.memoryPointer !== true || pointer.byref !== true || !Object.isFrozen(pointer) ||
      pointer.vmOwner !== vm.snapshotOwner || typeof pointer.readonly !== 'boolean' ||
      !Array.isArray(pointer.path) || !Object.isFrozen(pointer.path) || pointer.path.length ||
      !Number.isSafeInteger(pointer.index) || pointer.index < 0 || pointer.baseType?.registry !== vm.heap.methodTables) {
    throw new ManagedFault('InvalidProgramException', 'Malformed or foreign memory address');
  }
  if (write && pointer.readonly) throw new ManagedFault('InvalidProgramException', 'Read-only memory address');
  if (pointer.kind === 'stack') return checkedBytes(pointer, stackRegion(vm, pointer).bytes);
  if (pointer.kind === 'pinned') {
    const record = pinnedRecord(vm, pointer);
    const data = write ? vm.heap.ensureWritable(pointer.owner).data : record.data;
    return checkedBytes(pointer, rawArrayBytes(data));
  }
  if (pointer.kind === 'reinterpret') {
    const layout = valueLayout(vm, pointer.sourceType);
    if (layout.containsReferences) throw new ManagedFault('NotSupportedException', 'Reinterpretation cannot contain references');
    const bytes = new Uint8Array(layout.size);
    writeValue(vm, new DataView(bytes.buffer), 0, vm.dereference(pointer.source), pointer.sourceType);
    return checkedBytes(pointer, bytes);
  }
  throw new ManagedFault('InvalidProgramException', 'Unknown memory region');
}

/** Range-checked little-endian view. Reference slots never become raw bytes. */
export function rawMemoryView(vm, pointer, byteLength, {write = false} = {}) {
  const length = arrayInteger(byteLength, 'ArgumentOutOfRangeException');
  let bytes;
  let offset;
  if (pointer?.memoryPointer) {
    bytes = validateMemoryPointer(vm, pointer, {write});
    offset = pointer.index;
  } else if (pointer?.byref && pointer.kind === 'array' && Array.isArray(pointer.path) && !pointer.path.length) {
    if (!Object.isFrozen(pointer) || !Object.isFrozen(pointer.path) || pointer.vmOwner !== vm.snapshotOwner || write && pointer.readonly) {
      throw new ManagedFault('InvalidProgramException', 'Foreign or read-only managed address');
    }
    const record = vm.heap.get(pointer.owner);
    const data = write ? vm.heap.ensureWritable(pointer.owner).data : record.data;
    try { bytes = rawArrayBytes(data); }
    catch { throw new ManagedFault('NotSupportedException', 'Raw memory cannot contain managed references'); }
    offset = pointer.index * arrayElementBytes(record.methodTable.elementType);
  } else if (pointer?.byref && pointer.kind === 'static' && vm.inspector) {
    if (!Object.isFrozen(pointer) || pointer.vmOwner !== vm.snapshotOwner || write) {
      throw new ManagedFault('InvalidProgramException', 'RVA initialization data is read-only');
    }
    const token = typeof pointer.index === 'string' ? JSON.parse(pointer.index)[0] : pointer.index;
    const row = vm.inspector.metadata.rows[29]?.find(item => item[1] === (token & 0xffffff));
    if (!row) throw new ManagedFault('NotSupportedException', 'Static field has no raw initialization data');
    const field = vm.inspector.resolveToken(token);
    const size = valueLayout(vm, field.signature.type).size;
    const fileOffset = vm.inspector.pe.offsetOf(row[0], size);
    bytes = vm.inspector.pe.bytes.subarray(fileOffset, fileOffset + size);
    offset = 0;
  } else {
    throw new ManagedFault('NotSupportedException', 'Raw memory requires a primitive array or stack allocation');
  }
  if (length < 0 || !Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length - length) {
    throw new ManagedFault('IndexOutOfRangeException', 'Memory access exceeds its allocation');
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}

export function pointerOffset(vm, pointer, offset, type = pointer.baseType) {
  validateMemoryPointer(vm, pointer);
  const index = pointer.index + arrayInteger(offset, 'OverflowException');
  if (!Number.isSafeInteger(index) || index < 0) throw new ManagedFault('OverflowException', 'Pointer offset overflow');
  const result = memoryPointer(vm, {...pointer, index, baseType: vm.heap.methodTables.get(type)});
  const bytes = validateMemoryPointer(vm, result);
  if (index > bytes.length) throw new ManagedFault('IndexOutOfRangeException', 'Pointer exceeds its allocation');
  return result;
}

export function reinterpretPointer(vm, source, fromType, toType) {
  const sourceType = vm.heap.methodTables.get(fromType);
  const target = vm.heap.methodTables.get(toType);
  if (valueLayout(vm, sourceType).containsReferences || valueLayout(vm, target).containsReferences) {
    throw new ManagedFault('NotSupportedException', 'Unsafe.As cannot reinterpret managed references');
  }
  if (!source?.byref || source.vmOwner !== vm.snapshotOwner) throw new ManagedFault('InvalidProgramException', 'Managed address required');
  if (source.memoryPointer) return pointerOffset(vm, source, 0, target);
  const pointer = memoryPointer(vm, {
    kind: 'reinterpret', source, sourceType, owner: source.owner, frameId: source.frameId,
    index: 0, baseType: target, readonly: !!source.readonly
  });
  validateMemoryPointer(vm, pointer);
  return pointer;
}

export function pointerBinary(vm, operation, left, right) {
  if (left?.memoryPointer && right?.memoryPointer) {
    validateMemoryPointer(vm, left);
    validateMemoryPointer(vm, right);
    const same = sameMemoryAllocation(left, right);
    if (operation !== 'sub' || !same) throw new ManagedFault('InvalidProgramException', 'Pointer arithmetic requires one allocation');
    return storage(BigInt(left.index - right.index), 'nint', vm.options);
  }
  if (operation === 'add' && right?.memoryPointer) return pointerOffset(vm, right, number(left));
  if (left?.memoryPointer && ['add', 'sub'].includes(operation)) {
    const offset = number(right);
    return pointerOffset(vm, left, operation === 'sub' ? -offset : offset);
  }
  throw new ManagedFault('InvalidProgramException', 'Unsupported pointer arithmetic');
}

function readValue(vm, view, offset, table) {
  const access = scalarAccess(table);
  if (access) {
    const value=storage(view['get' + access](offset, true), table.enumUnderlyingType?.name ?? table.name, vm.options);
    return table.name==='System.Boolean'&&vm.image&&!vm.inspector?!!value:value;
  }
  if (table.name === 'System.Decimal') {
    const flags = view.getUint32(offset, true);
    const coefficient = BigInt(view.getUint32(offset + 4, true)) << 64n |
      BigInt(view.getUint32(offset + 12, true)) << 32n | BigInt(view.getUint32(offset + 8, true));
    const scale = flags >>> 16 & 0xff;
    if (scale > 28 || flags & 0x7f00ffff) throw new ManagedFault('ArgumentException', 'Invalid Decimal bit layout');
    return Object.freeze({decimal: true, coefficient, scale, negative: !!(flags & 0x80000000)});
  }
  const layout = valueLayout(vm, table);
  if (hasExplicitLayout(vm, table)) return explicitValueFromBytes(vm, table, view, offset);
  return createValueFromFields(vm, table, table.fields.map((field, index) => readValue(vm, view, offset + layout.offsets[index], field.type)));
}

function writeValue(vm, view, offset, value, table) {
  const access = scalarAccess(table);
  if (access) {
    let raw = number(value?.enumType ? value.value : value);
    if (access.startsWith('Big')) raw = BigInt(raw);
    view['set' + access](offset, typeof raw === 'boolean' ? Number(raw) : raw, true);
    return;
  }
  if (table.name === 'System.Decimal') {
    view.setUint32(offset, value.scale << 16 | (value.negative ? 0x80000000 : 0), true);
    view.setUint32(offset + 4, Number(value.coefficient >> 64n & 0xffffffffn), true);
    view.setUint32(offset + 8, Number(value.coefficient & 0xffffffffn), true);
    view.setUint32(offset + 12, Number(value.coefficient >> 32n & 0xffffffffn), true);
    return;
  }
  const layout = valueLayout(vm, table);
  if (value.explicitBytes) {
    new Uint8Array(view.buffer, view.byteOffset + offset, layout.size).set(value.explicitBytes);
    return;
  }
  table.fields.forEach((field, index) => writeValue(vm, view, offset + layout.offsets[index], value.fields[index], field.type));
}

export function readMemory(vm, pointer, type = pointer.baseType) {
  const table = vm.heap.methodTables.get(type);
  const layout = valueLayout(vm, table);
  if (layout.containsReferences) throw new ManagedFault('NotSupportedException', 'Raw memory cannot contain managed references');
  return readValue(vm, rawMemoryView(vm, pointer, layout.size), 0, table);
}

export function writeMemory(vm, pointer, value, type = pointer.baseType) {
  const table = vm.heap.methodTables.get(type);
  const layout = valueLayout(vm, table);
  if (layout.containsReferences) throw new ManagedFault('NotSupportedException', 'Raw memory cannot contain managed references');
  value = isAggregateType(table) ? createValue(vm, table, value)
    : storage(value, table.enumUnderlyingType?.name ?? table.name, vm.options);
  if (pointer.kind === 'reinterpret') {
    const bytes = validateMemoryPointer(vm, pointer, {write: true});
    if (pointer.index > bytes.length - layout.size) throw new ManagedFault('IndexOutOfRangeException', 'Reinterpretation exceeds storage');
    const view = new DataView(bytes.buffer);
    writeValue(vm, view, pointer.index, value, table);
    vm.dereference(pointer.source, true, readValue(vm, view, 0, pointer.sourceType));
  } else writeValue(vm, rawMemoryView(vm, pointer, layout.size, {write: true}), 0, value, table);
  vm.writeRevision++;
  if (pointer.owner) vm.heap.mutationRevision++;
  return value;
}

export function copyBlock(vm, destination, source, length) {
  if (destination?.kind === 'reinterpret') throw new ManagedFault('NotSupportedException', 'Block target needs contiguous storage');
  const from = rawMemoryView(vm, source, length);
  const to = rawMemoryView(vm, destination, length, {write: true});
  const sourceBytes = new Uint8Array(from.buffer, from.byteOffset, from.byteLength);
  new Uint8Array(to.buffer, to.byteOffset, to.byteLength).set(sourceBytes);
  vm.writeRevision++;
  if (destination.owner) vm.heap.mutationRevision++;
}

export function initializeBlock(vm, destination, value, length) {
  if (destination?.kind === 'reinterpret') throw new ManagedFault('NotSupportedException', 'Block target needs contiguous storage');
  const view = rawMemoryView(vm, destination, length, {write: true});
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength).fill(Number(number(value)) & 0xff);
  vm.writeRevision++;
  if (destination.owner) vm.heap.mutationRevision++;
}
