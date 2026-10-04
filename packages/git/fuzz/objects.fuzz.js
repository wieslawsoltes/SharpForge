import { encodeTree, encodeCommit, encodeTag, serializeObject, parseObject, validateObject } from '../src/objects.js';

export function createObjectsFuzzer() {
  const oid = 'a'.repeat(40);
  const identity = 'Fuzzer <fuzz@example.test> 1700000000 +0000';
  const objects = [
    ['blob', new TextEncoder().encode('blob fixture\0binary')],
    ['tree', encodeTree([{ name: 'file', mode: 0o100644, oid }])],
    ['commit', encodeCommit({ tree: oid, author: identity, committer: identity, message: 'fixture\n' })],
    ['tag', encodeTag({ object: oid, type: 'commit', tag: 'v1', tagger: identity, message: 'tag\n' })]
  ];
  return {
    name: 'objects', corpus: objects.map(([type, data]) => ({ type, bytes: serializeObject(type, data), valid: true })),
    repair(bytes, iteration, seed) {
      if (iteration % 4) return bytes;
      const separator = bytes.indexOf(0);
      return serializeObject(seed.type, separator < 0 ? bytes : bytes.subarray(separator + 1));
    },
    parse(bytes) {
      const object = parseObject(bytes, { maxObjectBytes: 4096 });
      validateObject(object.type, object.data, { maxObjectBytes: 4096, maxEntries: 32, maxHeaders: 32 });
    }
  };
}
