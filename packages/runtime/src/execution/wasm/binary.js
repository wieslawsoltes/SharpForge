/** Bounded WebAssembly binary writer. Integers use canonical LEB128. */
export class WasmBinary {
  constructor(limit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16777216) throw new RangeError('Invalid Wasm byte limit');
    this.limit = limit;
    this.data = [];
  }

  byte(value) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('Invalid Wasm byte');
    if (this.data.length >= this.limit) throw new RangeError('Wasm byte limit exceeded');
    this.data.push(value);
    return this;
  }

  bytes(values) {
    if (!(values instanceof Uint8Array) && !Array.isArray(values)) throw new TypeError('Wasm bytes must be an array');
    if (values.length > this.limit - this.data.length) throw new RangeError('Wasm byte limit exceeded');
    for (const value of values) this.byte(value);
    return this;
  }

  unsigned(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Invalid Wasm u32');
    do {
      const next = value % 128;
      value = Math.floor(value / 128);
      this.byte(next | (value ? 128 : 0));
    } while (value);
    return this;
  }

  signed(value) {
    if (typeof value !== 'bigint' && !Number.isSafeInteger(value)) throw new RangeError('Invalid Wasm signed integer');
    value = BigInt(value);
    if (value < -(1n << 63n) || value >= 1n << 63n) throw new RangeError('Wasm signed integer exceeds 64 bits');
    let more = true;
    while (more) {
      const next = Number(value & 127n);
      value >>= 7n;
      more = !((value === 0n && !(next & 64)) || (value === -1n && (next & 64)));
      this.byte(next | (more ? 128 : 0));
    }
    return this;
  }

  text(value) {
    if (typeof value !== 'string' || value.length > this.limit - this.data.length) throw new RangeError('Invalid Wasm name');
    const encoded = new TextEncoder().encode(value);
    return this.unsigned(encoded.length).bytes(encoded);
  }

  section(id, payload) {
    return this.byte(id).unsigned(payload.data.length).bytes(payload.data);
  }

  finish() { return Uint8Array.from(this.data); }
}
