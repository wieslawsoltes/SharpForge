/** Marker for immutable record copies shared by successive heap snapshots. */
export const sharedSnapshotRecord = Symbol('SharpForge shared snapshot record');

/** A snapshot owns its typed bytes without exposing a writable ArrayBuffer. */
export class ReadonlySnapshotArray {
  #data;
  #bytes;

  constructor(data) {
    if (!ArrayBuffer.isView(data) || data instanceof DataView) {
      throw new TypeError('A primitive typed array is required');
    }
    this.#data = data.slice();
    this.#bytes = new Uint8Array(this.#data.buffer, this.#data.byteOffset, this.#data.byteLength);
    this.readonlySnapshotArray = true;
    this.typedArrayName = data.constructor.name;
    this.length = data.length;
    this.byteLength = data.byteLength;
    Object.freeze(this);
  }

  read(index) {
    return this.#data[index];
  }

  [Symbol.iterator]() {
    return this.#data[Symbol.iterator]();
  }

  /** Return independent mutable storage for restore or wire encoding. */
  toMutableArray() {
    return this.#data.slice();
  }

  /** Bit comparison preserves NaN payloads and detects writes through retained host views. */
  equals(data) {
    if (data?.constructor.name !== this.typedArrayName || data.byteLength !== this.byteLength) return false;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== this.#bytes[index]) return false;
    }
    return true;
  }
}

/** The snapshots' array records accept reference slots and primitive backing. */
export function isSnapshotSequence(value) {
  return Array.isArray(value) || value instanceof ReadonlySnapshotArray
    || ArrayBuffer.isView(value) && !(value instanceof DataView);
}

export function snapshotSequenceValue(value, index) {
  return value instanceof ReadonlySnapshotArray ? value.read(index) : value[index];
}

/** Compute managed payload bytes; reference slots retain the established ABI. */
export function heapDataBytes(data) {
  if (ArrayBuffer.isView(data) || data instanceof ReadonlySnapshotArray) return data.byteLength;
  return data.length * 8;
}
