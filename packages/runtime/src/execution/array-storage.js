// Heap backing primitives. This module must not import the heap or VM.
const constructors = new Map([
  ['System.Boolean', Uint8Array], ['System.SByte', Int8Array], ['System.Byte', Uint8Array],
  ['System.Char', Uint16Array], ['System.Int16', Int16Array], ['System.UInt16', Uint16Array],
  ['System.Int32', Int32Array], ['System.UInt32', Uint32Array],
  ['System.Int64', BigInt64Array], ['System.UInt64', BigUint64Array],
  ['System.Single', Float32Array], ['System.Double', Float64Array]
]);

export function isArrayStorage(data) {
  return !!(Object.isFrozen(data) && data?.readonlySnapshotArray === true) || Array.isArray(data) || ArrayBuffer.isView(data) && !(data instanceof DataView);
}

/** Number of managed payload bytes, excluding the record header. */
export function arrayStorageBytes(data) {
  return ArrayBuffer.isView(data) || data?.readonlySnapshotArray ? data.byteLength : data.length * 8;
}

export function cloneArrayStorage(data) {
  return data?.readonlySnapshotArray ? data.toMutableArray() : data.slice();
}

/** Normalize to the declared primitive width; replacement callers always request independent ownership. */
export function normalizeArrayStorage(element, data, copy = false) {
  const constructor = primitiveArrayConstructor(element);
  if (!constructor || data instanceof constructor) return copy ? cloneArrayStorage(data) : data;
  if (data?.readonlySnapshotArray && data.typedArrayName === constructor.name) return cloneArrayStorage(data);
  const result = new constructor(data.length);
  for (let index = 0; index < data.length; index++) {
    storageWrite(result, index, data?.readonlySnapshotArray ? data.read(index) : data[index]);
  }
  return result;
}

export function primitiveArrayConstructor(element) {
  const type = element.enumUnderlyingType ?? element;
  if (['System.IntPtr', 'System.UIntPtr'].includes(type.name)) {
    const unsigned = type.name === 'System.UIntPtr';
    return type.registry.nativeIntBits === 64
      ? unsigned ? BigUint64Array : BigInt64Array
      : unsigned ? Uint32Array : Int32Array;
  }
  return constructors.get(type.name) ?? null;
}

export function arrayElementBytes(element) {
  return primitiveArrayConstructor(element)?.BYTES_PER_ELEMENT ?? 8;
}

/** Primitive arrays own contiguous storage; reference/aggregate arrays keep slots. */
export function primitiveArrayStorage(element, length, defaultValue = null) {
  const constructor = primitiveArrayConstructor(element);
  return constructor ? new constructor(length) : Array(length).fill(defaultValue);
}

export function storageRead(data, index, element = null, context = {}) {
  const value = data?.readonlySnapshotArray ? data.read(index) : data[index];
  if (!ArrayBuffer.isView(data) || !element) return value;
  const type = element.enumUnderlyingType ?? element;
  if (type.name === 'System.Boolean') return context.source ? !!value : value;
  if (type.name === 'System.Single' || type.name === 'System.Double') {
    return Object.freeze({float: type.name === 'System.Single' ? 'r4' : 'r8', value});
  }
  if (type.name === 'System.IntPtr' || type.name === 'System.UIntPtr') {
    return Object.freeze({nativeInt: type.registry.nativeIntBits, value});
  }
  // CLI I8 evaluation slots carry the bit pattern as signed BigInt.
  if (type.name === 'System.UInt64') return BigInt.asIntN(64, value);
  if (type.name === 'System.UInt32') return value | 0;
  return value;
}

export function storageWrite(data, index, value) {
  let raw = value;
  if (ArrayBuffer.isView(data)) {
    if (raw?.enumType || raw?.float || raw?.nativeInt) raw = raw.value;
    if (typeof raw === 'boolean') raw = Number(raw);
    if (data instanceof BigInt64Array || data instanceof BigUint64Array) raw = BigInt(raw);
  }
  data[index] = raw;
  return value;
}

export function storageValues(data) {
  return data[Symbol.iterator]();
}

/** A live byte view is only valid until the caller yields or crosses a heap barrier. */
export function rawArrayBytes(data) {
  if (!ArrayBuffer.isView(data) || data instanceof DataView) {
    throw new TypeError('Raw memory requires a primitive typed array');
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
