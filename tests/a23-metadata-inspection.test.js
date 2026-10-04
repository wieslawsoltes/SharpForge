import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectMetadataReference } from '@sharpforge/compiler';

const fixture = name => new Uint8Array(readFileSync(new URL(`./fixtures/metadata/${name}`, import.meta.url)));

test('A23 metadata inspection preserves real assembly identities and dependency counts', () => {
  const core = inspectMetadataReference(fixture('MiniStandard.dll'));
  assert.equal(core.name, 'MiniStandard');
  assert.match(core.identity, /^MiniStandard, Version=2\.1\.0\.0, Culture=neutral, PublicKeyToken=[0-9a-f]{16}$/);
  assert.equal(core.references, 0);
  const library = inspectMetadataReference(fixture('VersionedLib.1.0.0.0.dll'));
  assert.equal(library.name, 'VersionedLib');
  assert.match(library.identity, /^VersionedLib, Version=1\.0\.0\.0, Culture=neutral, PublicKeyToken=[0-9a-f]{16}$/);
  assert.equal(library.references, 1);
});

test('A23 metadata inspection respects byte views and leaves caller bytes unchanged', () => {
  const bytes = fixture('MiniStandard.dll');
  const padded = new Uint8Array(bytes.byteLength + 16);
  padded.set(bytes, 8);
  const view = padded.subarray(8, 8 + bytes.byteLength);
  assert.deepEqual(inspectMetadataReference(view), inspectMetadataReference(bytes));
  assert.deepEqual(view, bytes);
  assert.deepEqual(padded.subarray(0, 8), new Uint8Array(8));
});

test('A23 metadata inspection rejects wrong types and malformed images explicitly', () => {
  for (const value of [null, [], new ArrayBuffer(8), 'assembly.dll']) {
    assert.throws(() => inspectMetadataReference(value), RangeError);
  }
  assert.throws(() => inspectMetadataReference(new Uint8Array(64)), /missing MZ header/);
  assert.throws(() => inspectMetadataReference(fixture('MiniStandard.dll').subarray(0, 128)));
});

test('A23 metadata inspection admits the exact byte budget and rejects the next byte', () => {
  const bytes = new Uint8Array(67108865);
  assert.throws(() => inspectMetadataReference(bytes.subarray(0, 67108864)), /missing MZ header/);
  assert.throws(() => inspectMetadataReference(bytes), { name: 'RangeError', message: 'Metadata reference byte limit exceeded' });
});
