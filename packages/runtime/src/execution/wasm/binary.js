/** Minimal bounded WebAssembly binary writer. Integers use canonical LEB128. */
export class WasmBinary {
  constructor() {
    this.data = [];
  }

  byte(value) {
    this.data.push(value & 255);
    return this;
  }

  bytes(values) {
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
    value = BigInt(value);
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
    const encoded = new TextEncoder().encode(value);
    return this.unsigned(encoded.length).bytes(encoded);
  }

  section(id, payload) {
    return this.byte(id).unsigned(payload.data.length).bytes(payload.data);
  }

  finish() {
    return Uint8Array.from(this.data);
  }
}
