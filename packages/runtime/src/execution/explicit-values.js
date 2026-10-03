import {ManagedFault, isReference} from '../heap.js';
import {valueLayout} from './value-layout.js';
import {byteLayout, explicitLayout} from './explicit-layout.js';
import {scalarAccess, readScalarBytes, writeScalarBytes} from './scalar-bytes.js';

const frozenBytes = bytes => Object.freeze(Array.from(bytes));
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const sameReference = (left, right) => left === right || left?.h === right?.h && left?.g === right?.g;

function references(vm, table, value, {offset, slots, strict = false}) {
  if (!table.flags.valueType) {
    if (value !== null) {
      if (!isReference(value)) invalid('Explicit reference field requires a managed reference');
      vm.heap.get(value);
    }
    if (strict && slots.has(offset) && !sameReference(slots.get(offset), value)) invalid('Inconsistent explicit reference aliases');
    slots.set(offset, value);
  } else if (!scalarAccess(table)) {
    const layout = valueLayout(vm, table);
    table.fields.forEach((field, index) => references(vm, field.type, value.fields[index],
      {offset: offset + layout.offsets[index], slots, strict}));
  }
}

function write(vm, view, table, value, offset, slots) {
  if (!table.flags.valueType) {
    references(vm, table, value, {offset, slots});
    return;
  }
  if (scalarAccess(table)) {
    writeScalarBytes(view, offset, value, table);
    return;
  }
  const layout = valueLayout(vm, table);
  if (value.explicitBytes) {
    new Uint8Array(view.buffer, view.byteOffset + offset, layout.size).set(value.explicitBytes);
    references(vm, table, value, {offset, slots});
    return;
  }
  new Uint8Array(view.buffer, view.byteOffset + offset, layout.size).fill(0);
  table.fields.forEach((field, index) => write(vm, view, field.type, value.fields[index],
    offset + layout.offsets[index], slots));
}

function read(vm, view, table, offset, slots) {
  if (!table.flags.valueType) return slots.get(offset) ?? null;
  if (scalarAccess(table)) return readScalarBytes(vm, view, offset, table);
  const layout = valueLayout(vm, table);
  const fields = table.fields.map((field, index) => read(vm, view, field.type, offset + layout.offsets[index], slots));
  const value = {valueType: table, fields: Object.freeze(fields),
    explicitBytes: frozenBytes(new Uint8Array(view.buffer, view.byteOffset + offset, layout.size))};
  return Object.freeze(value);
}

function storage(vm, value) {
  const plan = byteLayout(vm, value.valueType);
  const bytes = value.explicitBytes;
  if (!Object.isFrozen(value) || !Object.isFrozen(value.fields) || !Array.isArray(bytes) ||
      !Object.isFrozen(bytes) || bytes.length !== plan.size ||
      bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) invalid('Malformed explicit value bytes');
  const slots = new Map();
  references(vm, value.valueType, value, {offset: 0, slots, strict: true});
  return {view: new DataView(Uint8Array.from(bytes).buffer), slots};
}

/** Fields are read views of one immutable byte sequence plus managed reference slots. */
export function createExplicitValue(vm, table, fields) {
  const plan = explicitLayout(vm, table);
  if (!plan) return null;
  const view = new DataView(new ArrayBuffer(plan.size));
  const slots = new Map();
  table.fields.forEach((field, index) => write(vm, view, field.type, fields[index], plan.offsets[index], slots));
  return read(vm, view, table, 0, slots);
}

/** Copy all bytes, including padding and payload bits not observable through scalar views. */
export function copyExplicitValue(vm, value) {
  const {view, slots} = storage(vm, value);
  return read(vm, view, value.valueType, 0, slots);
}

/** Return a new value after writing one field; the old value and every alias remain immutable. */
export function replaceExplicitField(vm, value, index, replacement) {
  const {view, slots} = storage(vm, value);
  write(vm, view, value.valueType.fields[index].type, replacement, valueLayout(vm, value.valueType).offsets[index], slots);
  return read(vm, view, value.valueType, 0, slots);
}

function sameValue(left, right, depth = 0) {
  if (Object.is(left, right)) return true;
  if (depth > 128 || !left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) &&
    sameValue(left[key], right[key], depth + 1));
}

/** Snapshot preflight reconstructs aliases without modifying the live heap. */
export function validateExplicitValue(vm, value) {
  const plan = explicitLayout(vm, value.valueType);
  if (!plan && !Object.hasOwn(value, 'explicitBytes')) return;
  const expected = copyExplicitValue(vm, value);
  if (!sameValue(expected.fields, value.fields)) invalid('Explicit fields disagree with their byte storage');
}

/** Decode an explicit value from raw memory; reference-containing layouts are forbidden. */
export function readExplicitBytes(vm, table, view, offset) {
  const plan = explicitLayout(vm, table);
  if (!plan) return null;
  if (plan.containsReferences) invalid('Managed references cannot be decoded from raw bytes');
  return read(vm, view, table, offset, new Map());
}

/** Write retained bytes verbatim, returning false when ordinary field encoding should be used. */
export function writeExplicitBytes(vm, table, value, view, offset) {
  const plan = value.explicitBytes ? byteLayout(vm, table) : explicitLayout(vm, table);
  if (!plan) return false;
  if (plan.containsReferences) invalid('Managed references cannot be encoded as raw bytes');
  const stored = storage(vm, value);
  new Uint8Array(view.buffer, view.byteOffset + offset, plan.size).set(new Uint8Array(stored.view.buffer));
  return true;
}
