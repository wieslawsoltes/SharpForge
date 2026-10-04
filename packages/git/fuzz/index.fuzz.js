import { GitIndex, encodeIndex, decodeIndex } from '../src/index-file.js';
import { writePackIndex, readPackIndex } from '../src/pack/index.js';
import { hashBytes } from '../src/hash.js';
import { hexToBytes } from '../src/object-format.js';

export async function createIndexFuzzer() {
  const entries = [{ path: 'a.txt', oid: 'a'.repeat(40), mode: 0o100644 }, { path: 'dir/b.txt', oid: 'b'.repeat(40), mode: 0o100755 }];
  const corpus = [];
  for (const version of [2, 3, 4]) corpus.push({ kind: 'dirc', bytes: await encodeIndex(new GitIndex({ version, entries })), valid: true });
  corpus.push({ kind: 'pack-index', valid: true,
    bytes: await writePackIndex([{ oid: 'a'.repeat(40), offset: 12, crc: 42 }], 'b'.repeat(40)) });
  return {
    name: 'index', corpus,
    async repair(bytes, iteration) {
      if (iteration % 8 || bytes.length < 32) return bytes;
      bytes.set(hexToBytes(await hashBytes(bytes.subarray(0, -20))), bytes.length - 20);
      return bytes;
    },
    parse: (bytes, seed) => seed.kind === 'dirc' ? decodeIndex(bytes, { maxEntries: 32, maxBytes: 4096 })
      : readPackIndex(bytes, { maxObjects: 32 })
  };
}
