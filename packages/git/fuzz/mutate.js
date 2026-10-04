/** Reproducible xorshift32 mutation source. State is per run and never shared by parsers. */
export class MutationRandom {
  constructor(seed) { this.state = seed >>> 0 || 1; }
  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }
  integer(maximum) { return maximum ? this.next() % maximum : 0; }
}

export function sameBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Mutate bits, lengths, runs, truncation and splice boundaries without exceeding a caller-owned cap. */
export function mutateBytes(source, random, maximum = 4096) {
  let bytes = source.slice();
  const operation = random.integer(7);
  if (operation === 0 && bytes.length) {
    for (let count = 1 + random.integer(4); count; count--) bytes[random.integer(bytes.length)] ^= 1 << random.integer(8);
  } else if (operation === 1) bytes = bytes.slice(0, random.integer(bytes.length + 1));
  else if (operation === 2) {
    const length = Math.min(maximum, bytes.length + 1 + random.integer(32));
    const output = new Uint8Array(length);
    output.set(bytes.subarray(0, length));
    for (let index = bytes.length; index < length; index++) output[index] = random.next() & 255;
    bytes = output;
  } else if (operation === 3 && bytes.length) bytes.fill(random.next() & 255, random.integer(bytes.length));
  else if (operation === 4 && bytes.length >= 4) {
    const offset = random.integer(bytes.length - 3);
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, [0, 1, 0x7fffffff, 0xffffffff][random.integer(4)]);
  } else if (operation === 5 && bytes.length) {
    const offset = random.integer(bytes.length);
    const length = Math.min(bytes.length - offset, 1 + random.integer(32));
    bytes.copyWithin(random.integer(bytes.length), offset, offset + length);
  } else if (bytes.length) bytes[random.integer(bytes.length)] = random.next() & 255;
  if (sameBytes(source, bytes)) {
    if (!bytes.length) bytes = Uint8Array.of(255);
    else bytes[random.integer(bytes.length)] ^= 128;
  }
  return bytes;
}
