import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { writeZip, readZip, openZip, writeZipTo, deflateDynamic, crc32, Crc32 } from '@sharpforge/archive';

const encode = text => new TextEncoder().encode(text);
const streamBytes = async stream => new Uint8Array(await new Response(stream).arrayBuffer());

function sink() {
  const chunks = [];
  let aborted = null;
  return {
    stream: new WritableStream({ write(bytes) { chunks.push(bytes.slice()); }, abort(error) { aborted = error; } }),
    bytes() {
      const output = new Uint8Array(chunks.reduce((length, bytes) => length + bytes.length, 0));
      let offset = 0;
      for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.length; }
      return output;
    },
    get aborted() { return aborted; }
  };
}

test('ZIP64: 70000 entries round-trip and reference Python zipfile accepts every entry', () => {
  const files = Array.from({ length: 70000 }, (_, index) => ({ path: 'items/' + String(index).padStart(5, '0'), text: '' }));
  const bytes = writeZip(files, { maxEntries: 70000 });
  const entries = readZip(bytes, { maxEntries: 70000 });
  assert.equal(entries.length, 70000);
  assert.equal(entries.at(-1).path, 'items/69999');
  const reference = spawnSync('python', ['-c',
    'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert len(z.infolist())==70000; assert z.testzip() is None'], { input: bytes });
  assert.equal(reference.status, 0, reference.stderr.toString());
});

test('ZIP64: small forced archives, safe-integer metadata and corrupted locator rejection', async () => {
  const bytes = writeZip([{ path: 'entry.txt', text: 'test' }], { forceZip64: true });
  assert.equal(new TextDecoder().decode(readZip(bytes)[0].bytes), 'test');
  const archive = await openZip(new Blob([bytes]));
  assert.equal(new TextDecoder().decode(await archive.read('entry.txt')), 'test');
  archive.close();
  await assert.rejects(() => archive.read('entry.txt'), /closed/);
  const malformed = bytes.slice();
  const view = new DataView(malformed.buffer);
  view.setBigUint64(malformed.length - 34, BigInt(Number.MAX_SAFE_INTEGER) + 1n, true);
  assert.throws(() => readZip(malformed), /precision|ZIP64/);
  const missing = bytes.slice();
  new DataView(missing.buffer).setUint32(missing.length - 42, 0, true);
  assert.throws(() => readZip(missing), /directory|ZIP64/);
});

test('DEFLATE: dynamic and fixed output matches the platform reference and compresses text', () => {
  const bytes = encode('namespace Demo { public class Item { public string Name { get; set; } } }\n'.repeat(2000));
  const compressed = deflateDynamic(bytes);
  assert.equal((compressed[0] >> 1) & 3, 2);
  assert.deepEqual(new Uint8Array(inflateRawSync(compressed)), bytes);
  assert(compressed.length < bytes.length * 0.4);
  for (const level of ['fast', 'default']) {
    const zip = writeZip([{ path: 'source.cs', bytes }], { compression: 'deflate', level });
    assert.deepEqual(readZip(zip)[0].bytes, bytes);
    assert(zip.length < bytes.length * 0.4);
  }
  assert.throws(() => deflateDynamic(bytes, { maxBytes: 10 }), /oversized/);
  assert.throws(() => deflateDynamic(bytes, { maxChain: 0 }), /budget/);
});

test('ZIP streams: backpressure, CRC descriptors and portable fixed compression round-trip', async () => {
  const expected = encode('incremental archive contents\n'.repeat(10000));
  async function* source() {
    for (let index = 0; index < expected.length; index += 777) yield expected.subarray(index, index + 777);
  }
  for (const compression of ['store', 'deflate']) {
    const target = sink();
    const result = await writeZipTo([{ path: 'large.txt', source: source() }], target.stream, { compression, chunkSize: 8192 });
    assert.equal(result.inputBytes, expected.length);
    const bytes = target.bytes();
    assert.deepEqual(readZip(bytes)[0].bytes, expected);
    const archive = await openZip(new Blob([bytes]), { chunkSize: 1024 });
    assert.deepEqual(await streamBytes(archive.stream('large.txt')), expected);
    archive.close();
  }
});

test('ZIP streams: cancellation aborts the sink and closing an archive cancels active readers', async () => {
  const controller = new AbortController();
  const target = sink();
  async function* files() {
    yield { path: 'a', bytes: encode('a') };
    controller.abort();
    yield { path: 'b', bytes: encode('b') };
  }
  await assert.rejects(() => writeZipTo(files(), target.stream, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(target.aborted?.name, 'AbortError');
  const archive = await openZip(new Blob([writeZip([{ path: 'a', text: 'abcdef'.repeat(1000) }])]), { chunkSize: 128 });
  const iterator = archive.chunks('a');
  assert.equal((await iterator.next()).value.length, 128);
  archive.close();
  await assert.rejects(() => iterator.next(), { name: 'AbortError' });
});

test('ZIP metadata: preservation retains UTC seconds and executable mode, deterministic default ignores them', () => {
  const file = { path: 'tools/run.sh', text: 'exit 0\n', mode: 0o100755, mtime: Date.UTC(2024, 4, 6, 7, 8, 9) };
  const restored = readZip(writeZip([file], { preserveMetadata: true }), { preserveMetadata: true })[0];
  assert.equal(restored.mode, file.mode);
  assert.equal(restored.mtime, file.mtime);
  assert.deepEqual(writeZip([file]), writeZip([{ ...file, mode: 0o100644, mtime: 0 }]));
  assert.throws(() => writeZip([{ ...file, mode: 0o120777 }], { preserveMetadata: true }), /special/);
});

test('ZIP malformed corpus: CRC, ratios, paths, overlaps, truncation and count budgets reject before returning records', async () => {
  const bytes = writeZip([{ path: 'a', text: 'Hello' }, { path: 'b', text: 'World' }]);
  const corrupt = bytes.slice();
  corrupt[31] ^= 1;
  assert.throws(() => readZip(corrupt), error => error.code === 'SFZIP011');
  const archive = await openZip(new Blob([corrupt]));
  await assert.rejects(() => archive.read('a'), error => error.code === 'SFZIP011');
  const compressed = writeZip([{ path: 'bomb', text: 'x'.repeat(100000) }], { compression: 'deflate' });
  assert.throws(() => readZip(compressed, { maxCompressionRatio: 2 }), error => error.code === 'SFZIP005');
  assert.throws(() => readZip(bytes, { maxEntries: 1 }), /limit/);
  assert.throws(() => readZip(bytes.subarray(0, -1)), /directory/);
  for (const path of ['../a', 'a/../../b', '/root', 'C:/bad', 'NUL.txt']) assert.throws(() => writeZip([{ path, text: '' }]));
  const overlap = bytes.slice();
  const view = new DataView(overlap.buffer);
  const central = view.getUint32(overlap.length - 6, true);
  view.setUint32(central + 47 + 42, 0, true);
  assert.throws(() => readZip(overlap), /mismatch|Overlapping/);
  assert.equal(crc32(encode('123456789')), 0xcbf43926);
});

test('CRC32 slicing keeps byte-wise reference parity across short tails and chunk boundaries', () => {
  const reference = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (let length = 0; length < 129; length++) {
    const bytes = Uint8Array.from({ length }, (_value, index) => index * 13 & 255);
    assert.equal(crc32(bytes), reference(bytes));
    for (const boundary of [1, 7, 8, 9, 31, 64]) {
      const crc = new Crc32();
      for (let start = 0; start < bytes.length; start += boundary) crc.update(bytes.subarray(start, start + boundary));
      assert.equal(crc.value, reference(bytes));
    }
  }
});

test('Malformed ZIP path encodings and traversal expose stable archive diagnostics', () => {
  for (const [firstByte, code] of [[255, 'SFZIP008'], [47, 'SFZIP006']]) {
    const zip = writeZip([{ path: 'a.txt', text: 'value' }]);
    const view = new DataView(zip.buffer);
    const central = view.getUint32(zip.length - 6, true);
    zip[central + 46] = firstByte;
    zip[30] = firstByte;
    assert.throws(() => readZip(zip), error => error.code === code);
  }
  assert.throws(() => writeZip([{ path: '../escape', text: 'value' }]), error => error.code === 'SFZIP006');
});
