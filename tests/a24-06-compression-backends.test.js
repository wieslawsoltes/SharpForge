import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { compressDeflate } from '@sharpforge/archive';

test('Every DEFLATE backend enforces its input budget before starting compression', async () => {
  const bytes = new Uint8Array(1025);
  for (const backend of ['portable', 'platform', 'auto']) {
    await assert.rejects(() => compressDeflate(bytes, { backend, maxBytes: 1024 }), /oversized/);
    await assert.rejects(() => compressDeflate('invalid', { backend }), /input/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => compressDeflate(bytes, { backend, signal: controller.signal }), { name: 'AbortError' });
  }
  await assert.rejects(() => compressDeflate(bytes, { backend: 'unknown' }), /backend/);
});

test('Platform and portable compressors report actual backends and match zlib bytes', async t => {
  const bytes = new TextEncoder().encode('public class Archive { public int Value { get; set; } }\n'.repeat(4096));
  for (const backend of ['portable', 'auto']) {
    const result = await compressDeflate(bytes, { backend });
    assert.deepEqual(new Uint8Array(inflateRawSync(result.bytes)), bytes);
    assert(result.bytes.length < bytes.length * 0.4);
    assert(['portable', 'CompressionStream'].includes(result.backend));
    t.diagnostic(JSON.stringify({ requested: backend, actual: result.backend, runtime: process.version }));
  }
  let supported = true;
  try { new CompressionStream('deflate-raw'); } catch { supported = false; }
  if (!supported) {
    await assert.rejects(() => compressDeflate(bytes, { backend: 'platform' }), /available/);
    t.diagnostic('Platform raw DEFLATE is unavailable; only the portable backend was qualified.');
    return;
  }
  const result = await compressDeflate(bytes, { backend: 'platform' });
  assert.equal(result.backend, 'CompressionStream');
  assert.deepEqual(new Uint8Array(inflateRawSync(result.bytes)), bytes);
  await assert.rejects(() => compressDeflate(bytes, { backend: 'platform', maxOutputBytes: 1 }), /output budget/);
  assert.equal(new Uint8Array(inflateRawSync((await compressDeflate(new Uint8Array(), { backend: 'platform' })).bytes)).length, 0);
});

test('Aborting an active platform compression cancels the stream', async t => {
  try { new CompressionStream('deflate-raw'); }
  catch { t.skip('Raw CompressionStream is unavailable on this runtime'); return; }
  const controller = new AbortController();
  const pending = compressDeflate(new Uint8Array(1024 * 1024), { backend: 'auto', signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, { name: 'AbortError' });
});
