import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadBundledHarfBuzz, bundledTextFixtures} from '@sharpforge/rendering';

const assetBase = new URL('../', import.meta.url);
const fixture = bundledTextFixtures(assetBase);
const loadBinary = url => readFile(new URL(url));

test('bundled HarfBuzz engines own separate Wasm memory and their licensed font assets retain recorded hashes', async () => {
  const wasmBinary = await loadBinary(fixture.wasmURL);
  const first = await loadBundledHarfBuzz({wasmBinary}), second = await loadBundledHarfBuzz({wasmBinary});
  assert.notStrictEqual(first.module.HEAPU8.buffer, second.module.HEAPU8.buffer);
  const font = fixture.fonts[0], bytes = await loadBinary(font.url);
  const blob = first.hb.createBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const face = first.hb.createFace(blob, 0), instance = first.hb.createFont(face), buffer = first.hb.createBuffer();
  try {
    buffer.addText('office'); buffer.guessSegmentProperties();
    first.hb.shape(instance, buffer);
    assert(buffer.json(instance).every(glyph => Number.isSafeInteger(glyph.g) && glyph.g > 0));
  } finally { buffer.destroy(); instance.destroy(); face.destroy(); blob.destroy(); }
  for (const descriptor of fixture.fonts) {
    const data = await loadBinary(descriptor.url);
    assert.equal(createHash('sha256').update(data).digest('hex'), descriptor.sha256);
  }
});

test('the loader requires authorized bytes, rejects malformed budgets and propagates cancellation', async () => {
  await assert.rejects(loadBundledHarfBuzz(), /authorized/);
  await assert.rejects(loadBundledHarfBuzz({wasmBinary: new Uint8Array(7)}), /bounded/);
  const controller = new AbortController(); controller.abort();
  let requests = 0;
  await assert.rejects(loadBundledHarfBuzz({wasmURL: fixture.wasmURL, signal: controller.signal,
    loadBinary: () => { requests++; return new Uint8Array(8); }}), {name: 'AbortError'});
  assert.equal(requests, 0);
  const during = new AbortController();
  await assert.rejects(loadBundledHarfBuzz({wasmURL: fixture.wasmURL, signal: during.signal,
    loadBinary: async () => { during.abort(); return new Uint8Array(8); }}), {name: 'AbortError'});
});
