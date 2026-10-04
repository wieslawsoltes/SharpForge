import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portableText, portableFixtureRoot} from './fixtures/rendering/portable-text.js';
import {createPortableTextProvider} from '../packages/rendering/src/text/portable-provider.js';
import {bundledTextFixtures} from '../packages/rendering/src/text/bundled-fixtures.js';
import {OpenTypeFont} from '../packages/rendering/src/text/opentype.js';
import {TextLayoutService} from '../packages/rendering/src/text/layout.js';

test('portable loading is explicit, bounded and cancellation-aware before any engine allocation', async () => {
  const fixture = bundledTextFixtures(portableFixtureRoot);
  await assert.rejects(createPortableTextProvider(), error => error.code === 'SFRENDER140');
  let requests = 0;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createPortableTextProvider({...fixture, signal: controller.signal,
    loadBinary: async url => { requests++; return readFile(new URL(url)); }}), {name: 'AbortError'});
  assert.equal(requests, 0);
  await assert.rejects(createPortableTextProvider({...fixture,
    fonts: [{...fixture.fonts[0], sha256: '0'.repeat(64)}], loadBinary: url => readFile(new URL(url))}), /integrity/);
  await assert.rejects(createPortableTextProvider({...fixture, fonts: [{...fixture.fonts[0], bytes: new Uint8Array(4)}]}), /bounded/);
});

test('font, glyph and text work budgets fail diagnostically and disposal releases owned Wasm handles', async () => {
  const provider = await portableText({maxText: 32, maxClusters: 16, maxGlyphs: 16, maxWorkGlyphs: 100});
  const service = new TextLayoutService(provider), notices = [];
  service.subscribe(() => notices.push(provider.fontVersion));
  try {
    const run = service.layout('office', {fontSize: 24});
    assert.throws(() => provider.layout('x'.repeat(33)), error => error.code === 'SFRENDER082');
    assert.throws(() => provider.layout('x'.repeat(17)), error => error.code === 'SFRENDER082');
    assert.throws(() => provider.layout('a', {features: 'bad-feature'}), error => error.code === 'SFRENDER143');
    assert.throws(() => provider.layout('a', {variations: {wght: Infinity}}), error => error.code === 'SFRENDER143');
    assert.throws(() => provider.layout('a\u0301', {runs: [
      {start: 0, end: 1, style: {fontSize: 14}}, {start: 1, end: 2, style: {fontSize: 24}}
    ]}), error => error.code === 'SFRENDER143');
    assert.equal(provider.shaper.input, 0);
    provider.changed();
    assert.equal(service.cache.size, 0);
    assert.deepEqual(notices, [1]);
    assert.notEqual(service.layout('office', {fontSize: 24}), run);
    const canceled = new AbortController(); canceled.abort();
    assert.throws(() => service.layout('office', {fontSize: 24, signal: canceled.signal}), {name: 'AbortError'});
  } finally { service.dispose(); service.dispose(); }
  assert.equal(provider.fonts.faces.length, 0);
  assert.equal(provider.fonts.instances.size, 0);
  assert.equal(provider.shaper.input, 0);
  assert.equal(provider.shaper.buffer, null);
  assert.equal(provider.module, null);
  assert.throws(() => provider.layout('after'), error => error.code === 'SFRENDER081');
});

test('OpenType parsing copies bounded caller bytes and rejects malformed directories before native shaping', async () => {
  const bytes = await readFile(new URL('packages/rendering/vendor/fonts/SharpForgeSans-Variable.ttf', portableFixtureRoot));
  const font = new OpenTypeFont(bytes);
  const initial = font.bytes[0];
  bytes[0] ^= 255;
  assert.equal(font.bytes[0], initial);
  assert.equal(font.bytes.byteOffset, 0);
  assert.equal(font.bytes.buffer.byteLength, font.bytes.byteLength);
  assert.ok(font.axes.some(axis => axis.tag === 'wght'));
  assert.throws(() => new OpenTypeFont(new Uint8Array(11)), error => error.code === 'SFRENDER140');
  const corrupt = font.bytes.slice();
  corrupt[4] = 255; corrupt[5] = 255;
  assert.throws(() => new OpenTypeFont(corrupt), error => error.code === 'SFRENDER140');
  assert.throws(() => font.required('head').u32(10000000), error => error.code === 'SFRENDER140');
});
