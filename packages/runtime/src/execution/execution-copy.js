import {ManagedFault, isReference} from './managed-fault.js';
import {ReadonlySnapshotArray, sharedSnapshotRecord} from './snapshot-buffers.js';
import {isTypedFloatArray} from './typed-stack.js';

/** These identities are owned by the VM or are immutable managed values. */
export function immutableExecutionIdentity(value) {
  return !isTypedFloatArray(value) && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value) &&
    !(value instanceof Map) && !(value instanceof Set) && Object.isFrozen(value) && (
    Object.keys(value).length === 0 && [Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    isReference(value) || value.registry && value.flags
    || value.byref || value.runtimeHandle || value.methodPointer || value.valueType
    || value.enumType || value.float || value.nativeInt || value.decimal
    || value.span || value.nullableType || value.typedReference || value.runtimeArgumentHandle || value.argIterator
  );
}

function copyView(value, memo) {
  const buffer = copyExecution(value.buffer, memo);
  const copy = value instanceof DataView
    ? new DataView(buffer, value.byteOffset, value.byteLength)
    : new value.constructor(buffer, value.byteOffset, value.length);
  memo.set(value, copy);
  return copy;
}

/** Copy mutable execution graphs while retaining owned identities and aliases. */
export function copyExecution(value, memo = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (memo.has(value)) return memo.get(value);
  if (value[sharedSnapshotRecord] || value instanceof ReadonlySnapshotArray) return value;
  if (value instanceof Map) {
    const copy = new Map();
    memo.set(value, copy);
    for (const [key, item] of value) copy.set(copyExecution(key, memo), copyExecution(item, memo));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set();
    memo.set(value, copy);
    for (const item of value) copy.add(copyExecution(item, memo));
    return copy;
  }
  if (value instanceof ArrayBuffer) {
    const copy = value.slice(0);
    memo.set(value, copy);
    return copy;
  }
  if (ArrayBuffer.isView(value)) return copyView(value, memo);
  if (immutableExecutionIdentity(value)) return value;
  if (value instanceof ManagedFault) {
    const copy = new ManagedFault(value.name, value.message, value.reference);
    memo.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = copyExecution(value[key], memo);
    return copy;
  }
  const copy = Array.isArray(value) ? new Array(value.length)
    : Object.getPrototypeOf(value) === null ? Object.create(null) : {};
  memo.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      value: copyExecution(item, memo), enumerable: true, writable: true, configurable: true
    });
  }
  return Object.isFrozen(value) ? Object.freeze(copy) : copy;
}

/** Frame code belongs to a code generation; only execution storage is copied. */
export function copyFrames(frames, memo = new Map()) {
  if (memo.has(frames)) return memo.get(frames);
  const copies = [];
  memo.set(frames, copies);
  for (const frame of frames) {
    if (memo.has(frame)) {
      copies.push(memo.get(frame));
      continue;
    }
    const copy = {};
    memo.set(frame, copy);
    copies.push(copy);
    const {method, offsets, ...execution} = frame;
    Object.assign(copy, copyExecution(execution, memo), method ? {method, offsets} : {});
  }
  return copies;
}
