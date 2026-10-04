import {ManagedFault} from '../heap.js';
import {byteLayout, explicitByteBudget} from './explicit-layout.js';
import {scalarAccess, readScalarBytes, writeScalarBytes} from './scalar-bytes.js';

const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };

function reserve(vm, budget, size) {
  budget.bytes ??= explicitByteBudget(vm);
  if (size > budget.bytes) throw new ManagedFault('OutOfMemoryException', 'Explicit scalar copy exceeds its byte budget');
}

function read(vm, table, view, offset, budget) {
  if (scalarAccess(table)) return readScalarBytes(vm, view, offset, table);
  const layout = byteLayout(vm, table);
  reserve(vm, budget, layout.size);
  budget.bytes -= layout.size;
  budget.fields -= table.fields.length;
  if (budget.fields < 0) throw new ManagedFault('OutOfMemoryException', 'Explicit scalar copy exceeds its field budget');
  const fields = table.fields.map((field, index) => read(vm, field.type, view, offset + layout.offsets[index], budget));
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, layout.size);
  return Object.freeze({valueType: table, fields: Object.freeze(fields), explicitBytes: Object.freeze(Array.from(bytes))});
}

function sameViews(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) if (!sameViews(left[index], right[index])) return false;
    return true;
  }
  if (left.valueType || right.valueType) {
    if (left.valueType !== right.valueType) return false;
    return sameViews(left.fields, right.fields) && sameViews(left.explicitBytes, right.explicitBytes);
  }
  if (left.float || right.float) return left.float === right.float && Object.is(left.value, right.value);
  if (left.nativeInt || right.nativeInt) return left.nativeInt === right.nativeInt && left.value === right.value;
  return false;
}

function viewOf(vm, table, source, budget) {
  const layout = byteLayout(vm, table), bytes = source.explicitBytes;
  reserve(vm, budget, layout.size);
  if (!Array.isArray(bytes) || !Object.isFrozen(bytes) || bytes.length !== layout.size) invalid('Malformed explicit scalar bytes');
  for (const byte of bytes) if (!Number.isInteger(byte) || byte < 0 || byte > 255) invalid('Malformed explicit scalar bytes');
  return new DataView(Uint8Array.from(bytes).buffer);
}

/** Zero bytes provide all overlapping default field views, including nested padding. */
export function createExplicitValue(vm, table, budget) {
  const layout = byteLayout(vm, table);
  reserve(vm, budget, layout.size);
  return read(vm, table, new DataView(new ArrayBuffer(layout.size)), 0, budget);
}

/** Preserve every byte rather than re-encoding possibly overlapping scalar field views. */
export function copyExplicitValue(vm, table, source, normalizedFields, budget) {
  const result = read(vm, table, viewOf(vm, table, source, budget), 0, budget);
  if (!sameViews(normalizedFields, result.fields)) invalid('Explicit scalar fields disagree with their byte storage');
  return result;
}

function write(vm, table, value, view, offset) {
  if (scalarAccess(table)) {
    writeScalarBytes(view, offset, value, table);
    return;
  }
  const layout = byteLayout(vm, table);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, layout.size);
  if (value.explicitBytes) {
    bytes.set(value.explicitBytes);
    return;
  }
  bytes.fill(0);
  for (let index = 0; index < table.fields.length; index++) {
    write(vm, table.fields[index].type, value.fields[index], view, offset + layout.offsets[index]);
  }
}

/** Inputs have passed ordinary value storage; rebuild aliases after a single field write. */
export function replaceExplicitField(vm, value, index, replacement, budget) {
  const table = value.valueType, layout = byteLayout(vm, table);
  const view = viewOf(vm, table, value, budget);
  write(vm, table.fields[index].type, replacement, view, layout.offsets[index]);
  return read(vm, table, view, 0, budget);
}
