import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { getObjectFormat, bytesToHex } from '../object-format.js';
import { PACK_TYPE_NAMES, readUint32 } from './binary.js';
import { PackByteReader } from './stream.js';
import { PackResolver } from './resolver.js';

async function readEntryHeader(reader, options) {
  const offset = reader.offset;
  reader.beginEntry();
  let value = await reader.byte();
  const typeCode = (value >>> 4) & 7;
  let size = value & 15;
  let multiplier = 16;
  let count = 0;
  while (value & 128) {
    if (++count > 8) throw new GitError('Corrupt', 'Overlong pack object size');
    value = await reader.byte();
    size += (value & 127) * multiplier;
    multiplier *= 128;
    checkLimit(size, options.maxObjectBytes ?? 64 * 1024 * 1024, 'Pack object size');
  }
  const entry = { offset, size, type: PACK_TYPE_NAMES[typeCode] };
  if (typeCode === 6) {
    value = await reader.byte();
    let distance = value & 127;
    count = 0;
    while (value & 128) {
      if (++count > 8) throw new GitError('Corrupt', 'Overlong delta offset');
      value = await reader.byte();
      distance = (distance + 1) * 128 + (value & 127);
      checkLimit(distance, offset - 12, 'Delta backwards offset');
    }
    if (!distance || distance > offset - 12) throw new GitError('Corrupt', 'Delta offset points outside the pack');
    entry.baseOffset = offset - distance;
  } else if (typeCode === 7) {
    entry.baseOid = bytesToHex(await reader.read(getObjectFormat(options.algorithm ?? 'sha1').oidBytes));
  } else if (!entry.type) throw new GitError('Corrupt', 'Invalid pack object type', { typeCode });
  return entry;
}

/** Verify a PACK v2/v3 stream and install canonical objects. Refs must be published only after success. */
export async function readPack(source, options = {}) {
  const { algorithm = 'sha1', signal, maxObjects = 1_000_000, onProgress } = options;
  const reader = new PackByteReader(source, options);
  const resolver = new PackResolver(options);
  try {
    const header = await reader.read(12);
    if (String.fromCharCode(...header.subarray(0, 4)) !== 'PACK') throw new GitError('Corrupt', 'Invalid pack signature');
    const version = readUint32(header, 4);
    if (version !== 2 && version !== 3) throw new GitError('Unsupported', 'Unsupported pack version', { version });
    const count = checkLimit(readUint32(header, 8), maxObjects, 'Pack object count');
    for (let index = 0; index < count; index++) {
      checkCancelled(signal);
      const entry = await readEntryHeader(reader, options);
      entry.data = await reader.inflate(entry.size, options);
      entry.end = reader.offset;
      entry.crc = reader.endEntry();
      await resolver.accept(entry);
      onProgress?.({ phase: 'receiving', completed: index + 1, total: count, bytes: reader.offset });
    }
    const checksum = reader.hash.digest('hex');
    const expected = bytesToHex(await reader.read(getObjectFormat(algorithm).oidBytes, false));
    if (checksum !== expected) throw new GitError('Corrupt', 'Pack checksum does not match');
    await reader.finish();
    const resolved = await resolver.finish();
    return { version, count, checksum, bytes: reader.offset, ...resolved };
  } finally {
    await resolver.cleanup();
    await reader.close();
  }
}
