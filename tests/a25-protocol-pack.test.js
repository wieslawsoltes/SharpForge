import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { applyDelta, createDelta, encodeDeltaSize } from '../packages/git/src/pack/delta.js';
import { writePack } from '../packages/git/src/pack/writer.js';
import { readPack } from '../packages/git/src/pack/reader.js';
import { readPackIndex, writePackIndex, MultiPackIndex } from '../packages/git/src/pack/index.js';
import { createPackReader } from '../packages/git/src/pack/accessor.js';
import { hashObject, hashBytes } from '../packages/git/src/hash.js';
import { hexToBytes } from '../packages/git/src/object-format.js';
import { encodeText, concatBytes } from '../packages/git/src/protocol/bytes.js';
import { encodeObjectHeader, encodeOffsetDelta, writeUint32 } from '../packages/git/src/pack/binary.js';
import { deflateZlib } from '../packages/git/src/zlib.js';

function memoryOdb(algorithm = 'sha1') {
  const objects = new Map();
  return { objects, has: async oid => objects.has(oid), read: async oid => objects.get(oid),
    write: async (type, data) => {
      const oid = await hashObject(type, data, { algorithm });
      objects.set(oid, { oid, type, data: data.slice(), size: data.length });
      return oid;
    } };
}

async function* splitBytes(bytes, width = 19) {
  for (let offset = 0; offset < bytes.length; offset += width) yield bytes.subarray(offset, offset + width);
}

test('delta copy/insert roundtrips and validates base/target/copy/opcode boundaries', () => {
  const base = encodeText('hello world '.repeat(500));
  const target = base.slice();
  target.set(encodeText('changed'), 311);
  const delta = createDelta(base, target);
  assert.deepEqual(applyDelta(base, delta), target);
  assert.ok(delta.length < target.length / 10);
  assert.throws(() => applyDelta(base.subarray(1), delta), { code: 'Corrupt' });
  assert.throws(() => applyDelta(base, delta, { maxObjectBytes: 20 }), { code: 'Limit' });
  assert.throws(() => applyDelta(Uint8Array.of(0), Uint8Array.of(1, 1, 0)), { code: 'Corrupt' });
  assert.throws(() => applyDelta(Uint8Array.of(0), Uint8Array.of(1, 1, 0x91, 100, 1)), { code: 'Corrupt' });
  assert.deepEqual(applyDelta(new Uint8Array(), Uint8Array.of(0, 0)), new Uint8Array());
});

test('PACK writer/stream parser/IDX2/random accessor preserve SHA-1 and SHA-256 objects', async () => {
  for (const algorithm of ['sha1', 'sha256']) {
    const objects = [{ type: 'blob', data: encodeText('first file\n') }, { type: 'blob', data: encodeText('second file\n') }];
    const encoded = await writePack(objects, { algorithm });
    const odb = memoryOdb(algorithm);
    const parsed = await readPack(splitBytes(encoded.pack, 7), { odb, algorithm });
    assert.equal(parsed.count, 2);
    assert.equal(odb.objects.size, 2);
    const indexBytes = await writePackIndex(parsed.entries, parsed.checksum, { algorithm });
    const index = await readPackIndex(indexBytes, { algorithm });
    const reader = await createPackReader({ pack: encoded.pack, index, algorithm });
    const multi = new MultiPackIndex();
    multi.add('test', index, reader);
    for (const object of objects) {
      const oid = await hashObject(object.type, object.data, { algorithm });
      assert.deepEqual((await multi.read(oid)).data, object.data);
      assert.equal(index.lookup(oid).offset, parsed.entries.find(entry => entry.oid === oid).offset);
    }
    const broken = encoded.pack.slice();
    broken[broken.length - 1] ^= 1;
    await assert.rejects(readPack(broken, { algorithm }), { code: 'Corrupt' });
    const brokenIndex = indexBytes.slice();
    brokenIndex[20] ^= 1;
    await assert.rejects(readPackIndex(brokenIndex, { algorithm }), { code: 'Corrupt' });
  }
});

test('index supports 64-bit offset table and rejects duplicate object IDs', async () => {
  const oid = '1'.repeat(40);
  const second = '2'.repeat(40);
  const bytes = await writePackIndex([{ oid, offset: 0x80000000, crc: 42 }, { oid: second, offset: 0x100000001n, crc: 44 }], '0'.repeat(40));
  const index = await readPackIndex(bytes);
  assert.equal(index.lookup(oid).offset, 0x80000000);
  assert.equal(index.lookup(second).offset, 0x100000001);
  await assert.rejects(writePackIndex([{ oid, offset: 12 }, { oid, offset: 20 }], '0'.repeat(40)), { code: 'Corrupt' });
});

test('50-deep OFS chains and REF thin-pack bases resolve and enforce depth bounds', async () => {
  const base = encodeText('a long reference blob '.repeat(10));
  const header = new Uint8Array(12);
  header.set([80, 65, 67, 75]);
  writeUint32(header, 4, 2);
  writeUint32(header, 8, 51);
  const chunks = [header, encodeObjectHeader(3, base.length), await deflateZlib(base)];
  let previous = 12;
  let offset = chunks.reduce((sum, bytes) => sum + bytes.length, 0);
  for (let level = 0; level < 50; level++) {
    const delta = Uint8Array.from([...encodeDeltaSize(base.length), ...encodeDeltaSize(base.length), 0x90, base.length]);
    const encoded = [encodeObjectHeader(6, delta.length), encodeOffsetDelta(offset - previous), await deflateZlib(delta)];
    previous = offset;
    offset += encoded.reduce((sum, bytes) => sum + bytes.length, 0);
    chunks.push(...encoded);
  }
  const body = concatBytes(chunks);
  const pack = concatBytes([body, hexToBytes(await hashBytes(body))]);
  const parsed = await readPack(splitBytes(pack), { odb: memoryOdb(), maxDepth: 50 });
  assert.equal(parsed.entries.at(-1).depth, 50);
  await assert.rejects(readPack(pack, { odb: memoryOdb(), maxDepth: 49 }), { code: 'Limit' });
  const odb = memoryOdb();
  const baseOid = await odb.write('blob', base);
  writeUint32(header, 8, 1);
  const target = encodeText('a changed reference blob '.repeat(10));
  const delta = createDelta(base, target);
  const thinBody = concatBytes([header, encodeObjectHeader(7, delta.length), hexToBytes(baseOid), await deflateZlib(delta)]);
  const thin = concatBytes([thinBody, hexToBytes(await hashBytes(thinBody))]);
  await readPack(thin, { odb });
  assert.deepEqual((await odb.read(await hashObject('blob', target))).data, target);
  await assert.rejects(readPack(thin), { code: 'Corrupt' });
});

test('native git index-pack --strict accepts generated delta packs and produces byte-identical IDX2', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sharpforge-pack-'));
  try {
    execFileSync('git', ['init', '--bare', directory], { stdio: 'pipe' });
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(2000);
    const objects = Array.from({ length: 12 }, (_, index) => ({ type: 'blob', data: encodeText(`${text.slice(0, 1000)}${index}${text.slice(1000)}`) }));
    const encoded = await writePack(objects);
    const plain = await writePack(objects, { deltas: false });
    assert.ok(encoded.pack.length <= plain.pack.length * 0.7);
    const output = execFileSync('git', ['--git-dir', directory, 'index-pack', '--strict', '--stdin'], { input: encoded.pack }).toString().trim();
    const checksum = output.split(/\s+/).at(-1);
    const nativeIndex = await readFile(join(directory, 'objects', 'pack', `pack-${checksum}.idx`));
    const generated = await writePackIndex(encoded.entries, checksum);
    assert.deepEqual(generated, new Uint8Array(nativeIndex));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
