import test from 'node:test';
import assert from 'node:assert/strict';
import { compileToIL } from '@sharpforge/compiler';
import { AssemblyInspector, CilError, MetadataBuilder, Reader, loadAssembly, readMetadata, readPE, text, utf8 } from '@sharpforge/cil';

// Exact malformed version fields from the seed-1 PE campaign's cases 88 and 463.
// The original hash-named finding records and their full inputs remain unchanged.
const invalidVersions = [
  Uint8Array.of(0x76, 0x34, 0x2e, 0x30, 0x2e, 0x79, 0x84, 0x13, 0x56, 0xbd, 0xf8, 0xf7),
  Uint8Array.of(0x76, 0x0e, 0x15, 0x70, 0x0f, 0x22, 0x19, 0xa4, 0xb3, 0x76, 0x5d, 0x18),
];

function invalidUtf8(error) {
  assert(error instanceof CilError);
  assert.equal(error.name, 'CilError');
  assert.equal(error.message, 'Invalid UTF-8 text');
  assert(error.cause instanceof TypeError);
  assert.equal(error.cause.code, 'ERR_ENCODING_INVALID_ENCODED_DATA');
  assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false);
  return true;
}

function assembly() {
  const result = compileToIL('class Utf8Fixture { public static int Main() { return 7; } }', {
    name: 'Utf8Fixture', includeDebug: true, embedSources: false, portablePdb: false,
  });
  assert.equal(result.success, true);
  return result.assembly;
}

test('public CIL text preserves Unicode, exact BufferSource views, initial BOM handling and empty input', () => {
  const value = 'λ 🚀', encoded = utf8(value);
  assert.equal(text(encoded), value);
  assert.equal(text(encoded.buffer), value);
  const padded = new Uint8Array(encoded.length + 2).fill(0xff);
  padded.set(encoded, 1);
  assert.equal(text(padded.subarray(1, -1)), value);
  assert.equal(text(new DataView(padded.buffer, 1, encoded.length)), value);
  assert.equal(text(Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8('value\ufeff'))), 'value\ufeff');
  assert.equal(text(), '');
  assert.equal(text(new Uint8Array()), '');
  const rangeError = new CilError('range', 16);
  assert.equal(rangeError.message, 'range at 0x10');
  assert.equal(rangeError.offset, 16);
  assert.throws(() => new Reader(new Uint8Array()).u8(), CilError);
});

test('public CIL text reports only native invalid-encoding failures as CilError', () => {
  const malformed = [
    Uint8Array.of(0x80), Uint8Array.of(0xc2), Uint8Array.of(0xc0, 0x80),
    Uint8Array.of(0xed, 0xa0, 0x80), Uint8Array.of(0xf4, 0x90, 0x80, 0x80), ...invalidVersions,
  ];
  for (const input of malformed) {
    const before = input.slice();
    assert.throws(() => text(input), invalidUtf8);
    assert.deepEqual(input, before);
  }
  for (const input of [{}, 'plain string', null, 1, true]) {
    assert.throws(() => text(input), error => error instanceof TypeError && !(error instanceof CilError)
      && error.code === 'ERR_INVALID_ARG_TYPE');
  }
});

test('public CIL text preserves native detached-buffer behavior without relabeling argument errors', () => {
  const input = new ArrayBuffer(4);
  structuredClone(input, { transfer: [input] });
  let expected, nativeError;
  try { expected = new TextDecoder('utf-8', { fatal: true }).decode(input); }
  catch (error) { nativeError = error; }
  if (!nativeError) {
    assert.equal(text(input), expected);
    return;
  }
  assert.notEqual(nativeError.code, 'ERR_ENCODING_INVALID_ENCODED_DATA');
  assert.throws(() => text(input), error => !(error instanceof CilError)
    && error.constructor === nativeError.constructor && error.code === nativeError.code && error.message === nativeError.message);
});

test('public metadata reading rejects both retained malformed version fields before table decoding', () => {
  const input = new MetadataBuilder('Utf8Metadata').finish();
  assert.equal(readMetadata(input).version, 'v4.0.30319');
  assert.equal(new DataView(input.buffer, input.byteOffset).getUint32(12, true), 12);
  for (const version of invalidVersions) {
    const malformed = input.slice();
    malformed.set(version, 16);
    const before = malformed.slice();
    assert.throws(() => readMetadata(malformed), invalidUtf8);
    assert.deepEqual(malformed, before);
  }
});

test('public PE reader, inspector and loader reject invalid metadata UTF-8 through the same CilError contract', () => {
  const input = assembly(), parsed = readPE(input);
  assert.equal(parsed.metadata.version, 'v4.0.30319');
  assert.doesNotThrow(() => new AssemblyInspector(input));
  assert.doesNotThrow(() => loadAssembly(input));
  for (const version of invalidVersions) {
    const malformed = input.slice();
    malformed.set(version, parsed.metadataOffset + 16);
    assert.throws(() => readPE(malformed), invalidUtf8);
    assert.throws(() => new AssemblyInspector(malformed), invalidUtf8);
    assert.throws(() => loadAssembly(malformed), invalidUtf8);
    assert.throws(() => readPE(malformed, { maxBytes: malformed.length - 1 }), /assembly exceeds size limit/);
  }
});

test('public metadata string access rejects invalid UTF-8 without caching replacement characters', () => {
  const builder = new MetadataBuilder('Utf8Strings'), index = builder.string('valid');
  const input = builder.finish(), original = readMetadata(input);
  assert.equal(original.string(index), 'valid');
  const strings = original.streams.get('#Strings'), malformed = input.slice();
  malformed[strings.byteOffset - input.byteOffset + index] = 0x80;
  const parsed = readMetadata(malformed);
  assert.throws(() => parsed.string(index), invalidUtf8);
  assert.throws(() => parsed.string(index), invalidUtf8);
});

test('optional SharpForge debug metadata keeps inspector diagnostics and loader validation behavior', () => {
  const input = assembly(), parsed = readPE(input), debug = parsed.metadata.streams.get('#SF');
  assert(debug?.length > 0);
  const malformed = input.slice();
  malformed[debug.byteOffset - input.byteOffset] = 0xff;
  const inspector = new AssemblyInspector(malformed);
  assert(inspector.diagnostics.some(diagnostic => diagnostic.message === 'Malformed optional #SF debug metadata'));
  assert.throws(() => loadAssembly(malformed), error => error instanceof CilError && error.message === 'Invalid SharpForge CIL metadata');
});
