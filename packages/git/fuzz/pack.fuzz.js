import { readPack } from '../src/pack/reader.js';
import { writePack } from '../src/pack/writer.js';
import { hashBytes } from '../src/hash.js';
import { hexToBytes } from '../src/object-format.js';

export async function createPackFuzzer() {
  const empty = await writePack([]);
  const objects = await writePack([
    { type: 'blob', data: new TextEncoder().encode('fixture data '.repeat(8)) },
    { type: 'blob', data: new TextEncoder().encode('fixture data '.repeat(8) + 'changed') }
  ]);
  return {
    name: 'pack', corpus: [{ bytes: empty.pack, valid: true }, { bytes: objects.pack, valid: true }],
    async repair(bytes, iteration) {
      if (iteration % 8 || bytes.length < 32) return bytes;
      bytes.set(hexToBytes(await hashBytes(bytes.subarray(0, -20))), bytes.length - 20);
      return bytes;
    },
    parse: bytes => readPack(bytes, {
      maxObjects: 32, maxObjectBytes: 4096, maxPackBytes: 4096, maxBufferedBytes: 4096,
      maxDepth: 16, maxMemoryBytes: 131072
    })
  };
}
