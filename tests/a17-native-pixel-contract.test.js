import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pin } from '../scripts/conformance/oracle/toolchain.js';
import { bgraToRgba, hash, pixelDimensions, referenceMetadata, validateCatalog, validateDump } from './rendering/native/contract.js';

async function contractInput() {
  const bytes = await readFile(new URL('./rendering/native/fixtures.json', import.meta.url));
  const catalog = validateCatalog(JSON.parse(bytes));
  return { fixtures: catalog.fixtures, inputHash: hash(bytes), materials: [] };
}

function nativeObservation(fixture) {
  if (fixture.expected === 'load-error') return { id: fixture.id, status: 'load-error', xamlSha256: fixture.xamlSha256,
    exception: 'FixtureOnly.XamlParseException', hresult: -1 };
  const dimensions = pixelDimensions(fixture.width, fixture.height, fixture.dpr);
  return { id: fixture.id, status: 'pixels', xamlSha256: fixture.xamlSha256, file: fixture.id + '.bgra', dimensions,
    byteCount: dimensions[0] * dimensions[1] * 4, bgraSha256: 'a'.repeat(64), pixelFormat: 'BGRA8', alphaMode: 'premultiplied',
    colorSpace: 'srgb', origin: 'top-left', rasterizationScale: 1.25, rasterScaleMode: 'render-target-explicit-size',
    actualTheme: fixture.theme, focusTarget: fixture.focusTarget ?? null };
}

function nativeDump(input) {
  return { schemaVersion: 1, inputHash: input.inputHash, runtime: pin.runtime, culture: 'en-US', toolVersion: 'fixture-only',
    operatingSystem: { description: 'Fixture only, not a native capture', architecture: 'X64' },
    environment: { highContrast: false, textScaleFactor: 1, animationsEnabled: true },
    stabilityPolicy: { consecutiveCaptures: 3, maximumRenderingTurns: 120 }, observations: input.fixtures.map(nativeObservation) };
}

test('native pixel catalog binds shared XAML bytes and DPR/theme/focus input identities', async () => {
  const input = await contractInput();
  assert.equal(input.fixtures.length, 39);
  assert.equal(input.fixtures.filter(fixture => fixture.expected === 'pixels').length, 38);
  assert.deepEqual([...new Set(input.fixtures.map(fixture => fixture.dpr))], [1, 1.5, 2]);
  assert.equal(input.fixtures.filter(fixture => fixture.focusTarget === 'FocusButton').length, 2);
  for (const fixture of input.fixtures) {
    const bytes = await readFile(new URL('./rendering/native/fixtures/' + fixture.file, import.meta.url));
    assert.equal(hash(bytes), fixture.xamlSha256);
  }
  assert.match(input.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(validateDump(nativeDump(input), input, pin).observations.length, 39);
});

test('native BGRA conversion preserves alpha and row order without inventing opaque pixels', () => {
  const bgra = Uint8Array.of(8, 16, 32, 64, 0, 0, 0, 0, 255, 128, 16, 255, 1, 2, 3, 3);
  assert.deepEqual(bgraToRgba(bgra, [2, 2]), Uint8Array.of(32, 16, 8, 64, 0, 0, 0, 0, 16, 128, 255, 255, 3, 2, 1, 3));
  assert.deepEqual(bgra, Uint8Array.of(8, 16, 32, 64, 0, 0, 0, 0, 255, 128, 16, 255, 1, 2, 3, 3));
  for (const bytes of [Uint8Array.of(1, 0, 0, 0), Uint8Array.of(0, 5, 0, 4), Uint8Array.of(0, 0, 255, 254)]) {
    assert.throws(() => bgraToRgba(bytes, [1, 1]), /SFNPIX003.*premultiplied/);
  }
  assert.throws(() => bgraToRgba(new Uint8Array(3), [1, 1]), /SFNPIX003/);
  assert.throws(() => bgraToRgba(new Uint8Array(4), [0, 1]), /SFNPIX003/);
  assert.deepEqual(pixelDimensions(1.25, 2.5, 1.5), [2, 4]);
  assert.deepEqual(pixelDimensions(2048, 2048, 1), [2048, 2048]);
  for (const args of [[0, 1, 1], [1, 1, NaN], [2048, 2048, 1.5], [1, 1, 4.1]]) {
    assert.throws(() => pixelDimensions(...args), /SFNPIX001/);
  }
});

test('native reference contract rejects shape, hash, theme, runtime, alpha and negative-outcome drift', async () => {
  const input = await contractInput(), original = nativeDump(input);
  for (const mutate of [value => { value.inputHash = 'a'; }, value => { value.runtime = 'different'; },
    value => { value.environment.highContrast = null; }, value => { value.observations[0].dimensions[0]++; },
    value => { value.observations[0].byteCount--; }, value => { value.observations[0].file = '../unsafe'; },
    value => { value.observations[0].alphaMode = 'straight'; }, value => { value.observations[0].actualTheme = 'Dark'; },
    value => { value.observations[0].xamlSha256 = '0'.repeat(64); }, value => { value.observations.at(-1).exception = null; },
    value => { value.observations.at(-1).file = 'invented.bgra'; }, value => value.observations.pop()]) {
    const value = structuredClone(original);
    mutate(value);
    assert.throws(() => validateDump(value, input, pin), /SFNPIX00[45]/);
  }
  const provenance = { sourceRevision: 'b'.repeat(40), sourceDirty: false, captureCommand: ['fixture-only', 'not-executed'] };
  const metadata = referenceMetadata({ fixture: input.fixtures[0], observation: original.observations[0], dump: original,
    input, pin, provenance, pixelSha256: 'c'.repeat(64) });
  assert.equal(metadata.referenceKind, 'native-winui');
  assert.equal(metadata.xamlSha256, input.fixtures[0].xamlSha256);
  assert.equal(metadata.windowsAppSdkVersion, pin.windowsAppSDK);
  assert.equal(metadata.nativeEnvironment.rasterizationScale, 1.25);
  assert.equal(metadata.fixture.dpr, 1);
  assert.throws(() => referenceMetadata({ fixture: input.fixtures.at(-1), observation: original.observations.at(-1),
    dump: original, input, pin, provenance, pixelSha256: 'c'.repeat(64) }), /SFNPIX006/);
});

