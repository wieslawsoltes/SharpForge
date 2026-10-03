import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { IncrementalHash, hashObject } from '../hash.js';
import { deflateZlib } from '../zlib.js';
import { hexToBytes } from '../object-format.js';
import { concatBytes } from '../protocol/bytes.js';
import { Crc32, PACK_TYPES, encodeObjectHeader, encodeOffsetDelta, writeUint32 } from './binary.js';
import { createDelta } from './delta.js';

async function chooseEncoding(object, window, offset, options) {
  const compressed = await deflateZlib(object.data, { signal: options.signal });
  let result = { type: PACK_TYPES[object.type], bytes: compressed, size: object.data.length, depth: 0, base: null };
  if (!result.type) throw new GitError('Corrupt', 'Cannot pack unknown object type', { type: object.type });
  if (options.deltas === false || object.data.length < 32) return result;
  for (let index = window.length - 1; index >= 0; index--) {
    const base = window[index];
    if (base.type !== object.type || base.depth >= (options.maxDepth ?? 32)) continue;
    if (base.data.length > object.data.length * 2 || object.data.length > base.data.length * 2) continue;
    const delta = createDelta(base.data, object.data, { signal: options.signal });
    if (delta.length > object.data.length) continue;
    const encoded = await deflateZlib(delta, { signal: options.signal });
    const distance = encodeOffsetDelta(offset - base.offset);
    if (encoded.length + distance.length + 8 < result.bytes.length) {
      result = { type: PACK_TYPES.ofs, bytes: encoded, size: delta.length, depth: base.depth + 1, base: distance };
    }
  }
  return result;
}

/** Emit PACK v2 with a bounded same-type sliding delta window, incremental checksum and CRC metadata. */
export async function* writePackStream({ objects, count, algorithm = 'sha1', signal, onEntry, onProgress,
  maxObjects = 1_000_000, maxObjectBytes = 64 * 1024 * 1024, windowSize = 10, maxWindowBytes = 16 * 1024 * 1024, ...rest }) {
  checkLimit(count, maxObjects, 'Pack object count');
  checkLimit(windowSize, 64, 'Delta window');
  const hash = new IncrementalHash({ algorithm });
  const header = new Uint8Array(12);
  header.set([80, 65, 67, 75]);
  writeUint32(header, 4, 2);
  writeUint32(header, 8, count);
  hash.update(header);
  yield header;
  let offset = 12;
  let written = 0;
  let windowBytes = 0;
  const window = [];
  for await (const object of objects) {
    checkCancelled(signal);
    if (++written > count) throw new GitError('Corrupt', 'Pack source has more objects than declared');
    checkLimit(object.data.length, maxObjectBytes, 'Pack object bytes');
    const oid = await hashObject(object.type, object.data, { algorithm });
    if (object.oid && object.oid !== oid) throw new GitError('Corrupt', 'Pack source object ID does not match its content');
    const encoded = await chooseEncoding(object, window, offset, { ...rest, signal });
    const chunks = [encodeObjectHeader(encoded.type, encoded.size)];
    if (encoded.base) chunks.push(encoded.base);
    chunks.push(encoded.bytes);
    const crc = new Crc32();
    const begin = offset;
    for (const chunk of chunks) {
      hash.update(chunk);
      crc.update(chunk);
      offset += chunk.length;
      yield chunk;
    }
    const metadata = { oid, offset: begin, end: offset, crc: crc.digest(), type: object.type, size: object.data.length, depth: encoded.depth };
    await onEntry?.(metadata);
    onProgress?.({ phase: 'compressing', completed: written, total: count, bytes: offset });
    if (windowSize && object.data.length <= maxWindowBytes) {
      window.push({ type: object.type, data: object.data, offset: begin, depth: encoded.depth });
      windowBytes += object.data.length;
    }
    while (window.length > windowSize || windowBytes > maxWindowBytes) windowBytes -= window.shift().data.length;
  }
  if (written !== count) throw new GitError('Corrupt', 'Pack source has fewer objects than declared', { expected: count, actual: written });
  yield hexToBytes(hash.digest('hex'));
}

/** Convenience writer for bounded in-memory packs. Streaming callers should use writePackStream. */
export async function writePack(objects, options = {}) {
  const count = options.count ?? objects.length;
  const entries = [];
  const chunks = [];
  let size = 0;
  const maximum = options.maxPackBytes ?? 256 * 1024 * 1024;
  for await (const chunk of writePackStream({ ...options, objects, count, onEntry: entry => {
    entries.push(entry);
    return options.onEntry?.(entry);
  } })) {
    size = checkLimit(size + chunk.length, maximum, 'Encoded pack');
    chunks.push(chunk);
  }
  return { pack: concatBytes(chunks, maximum), entries, count };
}
