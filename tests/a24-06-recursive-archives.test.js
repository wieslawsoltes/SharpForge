import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readZip, writeZip, openZip } from '@sharpforge/archive';

const fixture = JSON.parse(await readFile(new URL('./fixtures/archive/quine.json', import.meta.url), 'utf8'));
const quine = new Uint8Array(Buffer.from(fixture.base64, 'base64'));

test('The pinned ZIP quine contains its exact original bytes according to reference Python zipfile', () => {
  assert.equal(quine.length, 866);
  const gitHash = createHash('sha1').update('blob ' + quine.length + '\0').update(quine).digest('hex');
  assert.equal(gitHash, fixture.gitBlob);
  const reference = spawnSync('python', ['-c',
    'import io,sys,zipfile; b=sys.stdin.buffer.read(); z=zipfile.ZipFile(io.BytesIO(b)); ' +
    'assert len(z.infolist())==1; assert z.read(z.infolist()[0])==b'], { input: quine });
  assert.equal(reference.status, 0, reference.stderr.toString());
});

test('A real ZIP quine is rejected by synchronous and bounded streaming extraction', async () => {
  assert.throws(() => readZip(quine), error => error.code === 'SFZIP014');
  let largest = 0;
  const blob = new Blob([quine]);
  const source = { size: blob.size, slice(start, end) {
    largest = Math.max(largest, end - start);
    return blob.slice(start, end);
  } };
  const archive = await openZip(source, { chunkSize: 128 });
  await assert.rejects(() => archive.read(archive.entries[0]), error => error.code === 'SFZIP014');
  archive.close();
  assert(largest <= 866);
  assert.throws(() => readZip(quine, { maxFileBytes: 865 }), error => error.code === 'SFZIP004');
  await assert.rejects(() => openZip(source, { maxTotalBytes: 865 }), error => error.code === 'SFZIP004');
});

test('Strict nested archive policy rejects a nested bomb without inflating its inner contents', async () => {
  const inner = writeZip([{ path: 'expanded.txt', text: 'x'.repeat(1024 * 1024) }], { compression: 'deflate' });
  const outer = writeZip([{ path: 'nested.zip', bytes: inner }], { compression: 'deflate' });
  const options = { nestedArchives: 'reject', maxFileBytes: 32 * 1024, maxTotalBytes: 32 * 1024 };
  assert.throws(() => readZip(outer, options), error => error.code === 'SFZIP014');
  const archive = await openZip(new Blob([outer]), { ...options, chunkSize: 128 });
  await assert.rejects(() => archive.read('nested.zip'), error => error.code === 'SFZIP014');
  archive.close();
  assert.deepEqual(readZip(outer, { maxFileBytes: 32 * 1024 })[0].bytes, inner);
  assert.throws(() => readZip(inner, { maxCompressionRatio: 10 }), error => error.code === 'SFZIP005');
  assert.throws(() => readZip(outer, { nestedArchives: 'unknown' }), error => error.code === 'SFZIP001');
});

test('Equal archive and payload sizes do not reject ordinary content or require whole-archive streaming copies', async () => {
  const expected = new TextEncoder().encode('ordinary content\n'.repeat(256));
  const compact = writeZip([{ path: 'content.txt', bytes: expected }], { compression: 'deflate' });
  const zip = new Uint8Array(expected.length);
  assert(compact.length < zip.length);
  zip.set(compact);
  new DataView(zip.buffer).setUint16(compact.length - 2, zip.length - compact.length, true);
  assert.deepEqual(readZip(zip)[0].bytes, expected);
  const archive = await openZip(new Blob([zip]), { chunkSize: 128 });
  assert.deepEqual(await archive.read('content.txt'), expected);
  archive.close();
});
