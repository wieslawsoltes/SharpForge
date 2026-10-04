import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {basename} from 'node:path';
import {loadBundledHarfBuzz} from '../src/text/harfbuzz-loader.js';
import {bundledTextFixtures} from '../src/text/bundled-fixtures.js';

const root = new URL('../../../', import.meta.url);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Capture raw upstream hbjs output. This intentionally imports no provider, font matcher, line layout, or glyph raster implementation. */
export async function captureHarfBuzzOracle() {
  const fixtures = bundledTextFixtures(root);
  const wasmBinary = await readFile(new URL(fixtures.wasmURL));
  const wasmHash = sha256(wasmBinary);
  if (wasmHash !== '3b802d1782b72fa5eeb0d7a108b561beb788248ecc1134845e20ba84e4642ca9') throw new Error('Unexpected pinned HarfBuzz engine');
  const {hb, module} = await loadBundledHarfBuzz({wasmBinary});
  const requests = JSON.parse(await readFile(new URL('tests/fixtures/rendering/harfbuzz-requests.json', root), 'utf8'));
  const fonts = new Map(), output = [];
  try {
    for (const descriptor of fixtures.fonts) {
      const bytes = await readFile(new URL(descriptor.url)), digest = sha256(bytes);
      if (digest !== descriptor.sha256) throw new Error('Unexpected font bytes: ' + descriptor.url);
      const blob = hb.createBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const face = hb.createFace(blob, 0);
      fonts.set(basename(fileURLToPath(new URL(descriptor.url))), {descriptor, blob, face, digest});
    }
    for (const request of requests.cases) output.push(captureCase(hb, module, fonts, request));
    return {version: 1, provenance: {engine: 'harfbuzzjs', release: '0.8.0',
      commit: 'ec5b439a1c2737be9c00b9e838abe8d782b83a83', harfbuzzVersion: hb.version_string(), wasmSha256: wasmHash,
      capture: 'packages/rendering/tools/capture-harfbuzz-oracle.js', expectedSource: 'raw upstream hbjs glyph info and positions',
      pixelQualification: 'not performed by this capture'}, cases: output};
  } finally { for (const font of fonts.values()) { font.face.destroy(); font.blob.destroy(); } }
}

function captureCase(hb, module, fonts, request) {
  const input = module.wasmExports.malloc(Math.max(2, request.text.length * 2));
  if (!input) throw new Error('Oracle input allocation failed');
  const text = new Uint16Array(module.wasmMemory.buffer, input, request.text.length);
  for (let index = 0; index < request.text.length; index++) text[index] = request.text.charCodeAt(index);
  try {
    const items = request.items ?? [{start: 0, end: request.text.length, font: request.font, script: request.script, direction: request.direction}];
    return {id: request.id, text: request.text, options: request.options,
      items: items.map(item => captureItem(hb, module, fonts.get(item.font), input, request, item))};
  } finally { module.wasmExports.free(input); }
}

function captureItem(hb, module, record, input, request, item) {
  if (!record) throw new Error('Oracle references an unpinned font');
  const font = hb.createFont(record.face), buffer = hb.createBuffer();
  try {
    const variations = {};
    for (const [tag, axis] of Object.entries(record.face.getAxisInfos())) {
      const requested = request.options.variations?.[tag] ?? (tag === 'wght' ? request.options.fontWeight ?? 400 : undefined)
        ?? (tag === 'opsz' ? request.options.fontSize : undefined) ?? axis.default;
      variations[tag] = Math.max(axis.min, Math.min(axis.max, requested));
    }
    font.setScale(record.face.upem, record.face.upem);
    if (Object.keys(variations).length) font.setVariations(variations);
    module.wasmExports.hb_buffer_add_utf16(buffer.ptr, input, request.text.length, item.start, item.end - item.start);
    buffer.setDirection(item.direction); buffer.setScript(item.script); buffer.setClusterLevel(0);
    if (request.options.language) buffer.setLanguage(request.options.language);
    buffer.setFlags([...(item.start === 0 ? ['BOT'] : []), ...(item.end === request.text.length ? ['EOT'] : [])]);
    buffer.guessSegmentProperties(); hb.shape(font, buffer, request.options.features ?? '');
    const positions = buffer.getGlyphPositions();
    return {...item, fontSha256: record.digest, unitsPerEm: record.face.upem, variations,
      glyphs: buffer.getGlyphInfos().map((info, index) => ({glyphId: info.codepoint, cluster: info.cluster, ...positions[index]}))};
  } finally { buffer.destroy(); font.destroy(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ?? fileURLToPath(new URL('tests/fixtures/rendering/harfbuzz-oracle.json', root));
  await writeFile(target, JSON.stringify(await captureHarfBuzzOracle(), null, 2) + '\n');
  process.stdout.write('Captured raw pinned HarfBuzz glyph oracle: ' + target + '\n');
}
