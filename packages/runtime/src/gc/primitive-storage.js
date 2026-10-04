import {booleanStorage, booleanStorageType} from './boolean-storage.js';

const arrayTypes = Object.freeze({
  getInt8: Int8Array, getUint8: Uint8Array, getInt16: Int16Array, getUint16: Uint16Array,
  getInt32: Int32Array, getUint32: Uint32Array, getFloat32: Float32Array, getFloat64: Float64Array
});

function numericValue(value, floating) {
  if (floating && (value?.float === 'r4' || value?.float === 'r8')) value = value.value;
  if (typeof value !== 'number') throw new TypeError('Numeric array element requires a number');
  return value;
}

function validateInteger64(value) {
  if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) {
    throw new TypeError('64-bit array element requires a bigint or safe integer');
  }
}

const numeric = (size, getter, setter) => Object.freeze({
  size,
  arrayType: arrayTypes[getter],
  validate(value) { numericValue(value, getter === 'getFloat32' || getter === 'getFloat64'); },
  read(view, offset) { return view[getter](offset, true); },
  write(view, offset, value) {
    view[setter](offset, numericValue(value, getter === 'getFloat32' || getter === 'getFloat64'), true);
  }
});

function native64(getter, setter) {
  const base = integer64(getter, setter);
  return Object.freeze({
    size: 8,
    arrayType: base.arrayType,
    validate: base.validate,
    read(view, offset) {
      const value = base.read(view, offset);
      return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : value;
    },
    write: base.write
  });
}

const integer64 = (getter, setter) => Object.freeze({
  size: 8,
  arrayType: getter === 'getBigInt64' ? BigInt64Array : BigUint64Array,
  validate: validateInteger64,
  read(view, offset) { return view[getter](offset, true); },
  write(view, offset, value) {
    validateInteger64(value);
    view[setter](offset, BigInt(value), true);
  }
});

const nativePointers64 = new Map([
  ['System.IntPtr', native64('getBigInt64', 'setBigInt64')],
  ['System.UIntPtr', native64('getBigUint64', 'setBigUint64')]
]);

const codecs = new Map([
  [booleanStorageType, booleanStorage],
  ['System.SByte', numeric(1, 'getInt8', 'setInt8')],
  ['System.Byte', numeric(1, 'getUint8', 'setUint8')],
  ['System.Char', numeric(2, 'getUint16', 'setUint16')],
  ['System.Int16', numeric(2, 'getInt16', 'setInt16')],
  ['System.UInt16', numeric(2, 'getUint16', 'setUint16')],
  ['System.Int32', numeric(4, 'getInt32', 'setInt32')],
  ['System.UInt32', numeric(4, 'getUint32', 'setUint32')],
  ['System.Int64', integer64('getBigInt64', 'setBigInt64')],
  ['System.UInt64', integer64('getBigUint64', 'setBigUint64')],
  ['System.Single', numeric(4, 'getFloat32', 'setFloat32')],
  ['System.Double', numeric(8, 'getFloat64', 'setFloat64')],
  ['System.IntPtr', numeric(4, 'getInt32', 'setInt32')],
  ['System.UIntPtr', numeric(4, 'getUint32', 'setUint32')]
]);

/** Registered physical representation; unknown/value-struct types use host slots. */
export function primitiveStorage(type, storageSize = null) {
  const name = typeof type === 'string' ? type : type?.enumUnderlyingType?.name ?? type?.name;
  if (storageSize === 8 && nativePointers64.has(name)) return nativePointers64.get(name);
  return codecs.get(name) ?? null;
}

export function writeUtf16(arena, block, text) {
  for (let index = 0; index < text.length; index++) {
    arena.view.setUint16(block.offset + index * 2, text.charCodeAt(index), true);
  }
}

export function readUtf16(arena, block, length) {
  let result = '';
  const characters = new Array(Math.min(length, 4096));
  for (let start = 0; start < length; start += 4096) {
    const count = Math.min(4096, length - start);
    characters.length = count;
    for (let index = 0; index < count; index++) {
      characters[index] = arena.view.getUint16(block.offset + (start + index) * 2, true);
    }
    result += String.fromCharCode(...characters);
  }
  return result;
}
