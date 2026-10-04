import { createHash } from 'node:crypto';

function objectHeader(size) {
  const bytes = [];
  let value = (3 << 4) | (size & 15);
  size = Math.floor(size / 16);
  while (size) {
    bytes.push(value | 128);
    value = size & 127;
    size = Math.floor(size / 128);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function randomBlock(length, state) {
  const bytes = Buffer.allocUnsafe(length);
  let value = state.value;
  for (let index = 0; index < length; index++) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    bytes[index] = value & 255;
  }
  state.value = value;
  return bytes;
}

function updateAdler(state, bytes) {
  let first = state.first;
  let second = state.second;
  for (const value of bytes) {
    first += value;
    second += first;
  }
  // A block is at most 65535 bytes, so these sums remain exact JavaScript integers.
  state.first = first % 65521;
  state.second = second % 65521;
}

async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes, offset, bytes.length - offset, null);
    if (!written.bytesWritten) throw new Error('Pack fixture file stopped accepting bytes');
    offset += written.bytesWritten;
  }
}

/** Independent PACK/zlib stored-block encoder. Only one small source block is resident at a time. */
export class IndependentPackSource {
  constructor(profile, file, sample) {
    this.profile = profile;
    this.file = file;
    this.sample = sample;
    this.expectedOids = [];
    this.bytes = 0;
    this.checksum = null;
  }

  *blob(index) {
    const { objectBytes, algorithm, seed } = this.profile;
    const random = { value: (seed ^ Math.imul(index + 1, 0x9e3779b9)) || 1 };
    const adler = { first: 1, second: 0 };
    const object = createHash(algorithm).update(Buffer.from(`blob ${objectBytes}\0`));
    yield objectHeader(objectBytes);
    yield Buffer.from([0x78, 0x01]);
    for (let offset = 0; offset < objectBytes; offset += 65535) {
      const length = Math.min(65535, objectBytes - offset);
      const header = Buffer.alloc(5);
      header[0] = offset + length === objectBytes ? 1 : 0;
      header.writeUInt16LE(length, 1);
      header.writeUInt16LE(length ^ 0xffff, 3);
      const data = randomBlock(length, random);
      updateAdler(adler, data);
      object.update(data);
      yield header;
      yield data;
    }
    this.expectedOids.push(object.digest('hex'));
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((adler.second * 65536 + adler.first) >>> 0);
    yield checksum;
  }

  *frames() {
    const header = Buffer.alloc(12);
    header.write('PACK', 0, 'ascii');
    header.writeUInt32BE(2, 4);
    header.writeUInt32BE(this.profile.objects, 8);
    yield header;
    for (let index = 0; index < this.profile.objects; index++) yield* this.blob(index);
  }

  async *[Symbol.asyncIterator]() {
    const hash = createHash(this.profile.algorithm);
    for (const bytes of this.frames()) {
      hash.update(bytes);
      await writeAll(this.file, bytes);
      this.bytes += bytes.length;
      this.sample();
      yield bytes;
    }
    const trailer = hash.digest();
    this.checksum = trailer.toString('hex');
    await writeAll(this.file, trailer);
    this.bytes += trailer.length;
    this.sample();
    yield trailer;
  }
}
