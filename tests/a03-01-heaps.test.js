import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, readMetadata, buildId } from '@sharpforge/cil';

test('A03 wide byte and GUID heaps round-trip and deduplicate owned bytes', () => {
  const builder = new MetadataBuilder('Heaps');
  const text = 'λ'.repeat(32768);
  const string = builder.string(text);
  const bytes = new Uint8Array(65536).fill(123);
  const blob = builder.blob(bytes);
  assert.equal(builder.blob(bytes.slice()), blob);
  bytes[0] = 42;
  const other = builder.blob(bytes);
  assert.notEqual(blob, other);
  let guid;
  for (let i = 0; i < 4096; i++) {
    const value = new Uint8Array(16);
    new DataView(value.buffer).setUint32(0, i, true);
    guid = builder.guid(value);
    assert.equal(builder.guid(value), guid);
  }
  const userString = builder.userString('A\0𝄞');
  assert.equal(builder.userString('A\0𝄞'), userString);
  const identity = new Uint8Array([1, 2, 3]);
  const metadata = readMetadata(builder.finish(null, identity));
  assert.equal(metadata.heapFlags & 7, 7);
  assert.equal(metadata.string(string), text);
  assert.equal(metadata.blob(blob)[0], 123);
  assert.equal(metadata.blob(other)[0], 42);
  assert.deepEqual(metadata.guid(1), buildId(identity));
  assert.equal(new DataView(metadata.guid(guid).buffer).getUint32(0, true), 4095);
  assert.equal(metadata.userString(0x70000000 | userString), 'A\0𝄞');
  assert.deepEqual(metadata.guid(0), new Uint8Array(16));
  for (const index of [-1, 0.5, guid + 1]) assert.throws(() => metadata.guid(index), /GUID heap index/);
  assert.throws(() => builder.guid(new Uint8Array(15)), /16 bytes/);
  assert.throws(() => builder.string('a\0b'), /NUL/);
});
