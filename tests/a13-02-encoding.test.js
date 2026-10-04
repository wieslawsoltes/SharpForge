import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileToIL } from '@sharpforge/compiler';
import { token } from '@sharpforge/cil';
import {
  decodeSource,
  emitPortablePdb,
  readPortablePdb,
  bindSources,
  verifySource,
  SymbolError,
} from '@sharpforge/symbols';

const fixtures = [
  { name: 'UTF-8', bytes: [99, 97, 102, 195, 169, 13, 10], encoding: 'utf-8', bomBytes: 0 },
  { name: 'UTF-8 BOM', bytes: [239, 187, 191, 99, 97, 102, 195, 169, 13, 10], encoding: 'utf-8', bomBytes: 3 },
  {
    name: 'UTF-16 LE',
    bytes: [255, 254, 99, 0, 97, 0, 102, 0, 233, 0, 13, 0, 10, 0],
    encoding: 'utf-16le',
    bomBytes: 2,
  },
  {
    name: 'UTF-16 BE',
    bytes: [254, 255, 0, 99, 0, 97, 0, 102, 0, 233, 0, 13, 0, 10],
    encoding: 'utf-16be',
    bomBytes: 2,
  },
  {
    name: 'Windows-1252',
    bytes: [99, 97, 102, 233, 13, 10],
    encoding: 'windows-1252',
    bomBytes: 0,
    options: { fallbackEncoding: 'windows-1252' },
  },
];
const compiled = compileToIL('Console.WriteLine(1);', { portablePdb: false });
assert(compiled.success);

for (const fixture of fixtures)
  test('source encoding verifies raw bytes before decoding: ' + fixture.name, () => {
    const bytes = new Uint8Array(fixture.bytes);
    assert.deepEqual(decodeSource(bytes, fixture.options), {
      text: 'café\r\n',
      encoding: fixture.encoding,
      bomBytes: fixture.bomBytes,
    });
    const emitted = emitPortablePdb(compiled.assembly, {
      sources: [{ uri: '/src/Text.cs', bytes }],
      sequencePoints: [
        { uri: '/src/Text.cs', methodToken: token(6, 1), ilOffset: 0, line: 1, column: 1, endLine: 1, endColumn: 5 },
      ],
    });
    const symbols = readPortablePdb(emitted.bytes);
    assert.deepEqual(symbols.documents[0].hash, new Uint8Array(createHash('sha256').update(bytes).digest()));
    const binding = bindSources(symbols, {}, fixture.options);
    assert.equal(binding.documents[0].verified, true);
    assert.equal(binding.documents[0].encoding, fixture.encoding);
    assert.equal(binding.sources[0].text, 'café\r\n');
    assert.equal(binding.sequencePoints[0].start, 0);
    assert.equal(binding.sequencePoints[0].end, 4);
    assert(binding.sequencePoints[0].sourceVerified);
    assert.equal(verifySource(symbols.documents[0], 'café\n'), false);
    const unverified = bindSources(symbols, { '/src/Text.cs': 'café\n' }, fixture.options);
    assert.equal(unverified.documents[0].text, null);
    assert.equal(unverified.sources.length, 0);
    assert(unverified.sequencePoints.every((point) => !point.sourceVerified));
  });

test('BOM selection takes precedence over fallback and malformed BOM-selected data fails', () => {
  assert.equal(decodeSource(new Uint8Array([239, 187, 191, 195, 169]), { fallbackEncoding: 'windows-1252' }).text, 'é');
  for (const bytes of [
    [239, 187, 191, 192],
    [255, 254, 97],
    [254, 255, 0],
  ]) {
    assert.throws(() => decodeSource(new Uint8Array(bytes), { fallbackEncoding: 'windows-1252' }), SymbolError);
  }
  for (const bytes of [
    [255, 254, 0, 0],
    [0, 0, 254, 255],
  ]) {
    assert.throws(() => decodeSource(new Uint8Array(bytes)), /UTF-32/);
  }
});

test('fallback is opt-in and unsupported encodings are explicit diagnostics', () => {
  assert.throws(() => decodeSource(new Uint8Array([233])), /Invalid utf-8/);
  assert.throws(() => decodeSource(new Uint8Array(), { fallbackEncoding: 'not-a-code-page' }), /Unsupported/);
  assert.throws(() => decodeSource(new Uint8Array(), { fallbackEncoding: 1252 }), /fallback/);
  assert.equal(decodeSource(new Uint8Array([128]), { fallbackEncoding: 'windows-1252' }).text, '€');
});

test('empty source, exact byte budget, typed views and unchanged input are supported', () => {
  assert.deepEqual(decodeSource(new Uint8Array(), { maxBytes: 0 }), { text: '', encoding: 'utf-8', bomBytes: 0 });
  const bytes = new Uint8Array([255, 65, 255]);
  assert.equal(decodeSource(bytes.subarray(1, 2), { maxBytes: 1 }).text, 'A');
  assert.deepEqual([...bytes], [255, 65, 255]);
  assert.throws(() => decodeSource(bytes.subarray(1, 2), { maxBytes: 0 }), /oversized/);
  assert.throws(() => decodeSource(new Uint8Array(), { maxBytes: -1 }), /limit/);
  assert.throws(() => decodeSource('text'), /source bytes/);
});
