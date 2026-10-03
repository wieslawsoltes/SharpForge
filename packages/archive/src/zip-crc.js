const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const slices = new Uint32Array(8 * 256);
slices.set(table);
for (let slice = 1; slice < 8; slice++) {
  for (let value = 0; value < 256; value++) {
    const previous = slices[(slice - 1) * 256 + value];
    slices[slice * 256 + value] = table[previous & 255] ^ (previous >>> 8);
  }
}

/** Incremental IEEE CRC-32, suitable for independently streamed ZIP entries. */
export class Crc32 {
  constructor() { this.state = 0xffffffff; }
  update(bytes) {
    let crc = this.state;
    let offset = 0;
    // Eight independent table lookups shorten the checksum dependency chain without per-block allocation.
    for (; offset + 8 <= bytes.length; offset += 8) {
      const word = crc ^ bytes[offset] ^ (bytes[offset + 1] << 8) ^ (bytes[offset + 2] << 16) ^ (bytes[offset + 3] << 24);
      crc = slices[1792 + (word & 255)] ^ slices[1536 + (word >>> 8 & 255)] ^ slices[1280 + (word >>> 16 & 255)] ^
        slices[1024 + (word >>> 24)] ^ slices[768 + bytes[offset + 4]] ^ slices[512 + bytes[offset + 5]] ^
        slices[256 + bytes[offset + 6]] ^ slices[bytes[offset + 7]];
    }
    for (; offset < bytes.length; offset++) crc = table[(crc ^ bytes[offset]) & 255] ^ (crc >>> 8);
    this.state = crc;
    return this;
  }
  get value() { return (this.state ^ 0xffffffff) >>> 0; }
}

export function crc32(bytes) { return new Crc32().update(bytes).value; }
