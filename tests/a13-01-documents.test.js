import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileToIL } from '@sharpforge/compiler';
import { Reader } from '@sharpforge/cil';
import { emitPortablePdb, readPortablePdb, PdbGuids } from '@sharpforge/symbols';

const compiled = compileToIL('Console.WriteLine(1);', { portablePdb: false });
assert.equal(compiled.success, true);
const encode = (sources) =>
  readPortablePdb(emitPortablePdb(compiled.assembly, { sources }, { embedSources: false }).bytes);
const utf8 = (value) => new TextEncoder().encode(value);

for (const path of ['', 'Program.cs', '/src/shared/one.cs', 'C:\\src\\one.cs', '/a\\b/', '/src//one.cs']) {
  test('document names preserve separator and empty components: ' + JSON.stringify(path), () => {
    const symbols = encode([{ uri: path, text: 'source' }]);
    assert.equal(symbols.documents[0].name, path);
    const blob = new Reader(symbols.metadata.blob(symbols.metadata.rows[48][0][0]));
    const separator = String.fromCharCode(blob.u8());
    assert.equal(separator, (path.match(/\//g)?.length ?? 0) >= (path.match(/\\/g)?.length ?? 0) ? '/' : '\\');
    const parts = [];
    while (blob.position < blob.end) parts.push(new TextDecoder().decode(symbols.metadata.blob(blob.compressed())));
    assert.deepEqual(parts, path.split(separator));
  });
}

test('shared document directory parts reuse the same blob indices', () => {
  const symbols = encode(['/src/common/one.cs', '/src/common/two.cs'].map((uri) => ({ uri, text: 'x' })));
  const parts = symbols.metadata.rows[48].map((row) => {
    const reader = new Reader(symbols.metadata.blob(row[0]));
    reader.u8();
    return [reader.compressed(), reader.compressed(), reader.compressed(), reader.compressed()];
  });
  assert.deepEqual(parts[0].slice(0, 3), parts[1].slice(0, 3));
  assert.notEqual(parts[0][3], parts[1][3]);
});

for (const algorithm of ['sha1', 'sha256', 'sha384', 'sha512']) {
  test('document writer preserves ' + algorithm + ' and non-C# language identities', () => {
    const bytes = utf8('\uFEFFsource\r\n𝄞');
    const hash = new Uint8Array(createHash(algorithm).update(bytes).digest());
    const language = '3a12d0b8-c26c-11d0-b442-00a0244a1dd2';
    const sources = [{ uri: '/src/module.vb', bytes, hashAlgorithm: PdbGuids[algorithm], hash, language }];
    const result = encode(sources).documents[0];
    assert.equal(result.hashAlgorithm, PdbGuids[algorithm]);
    assert.deepEqual(result.hash, hash);
    assert.equal(result.language, language);
  });
}

test('document writer rejects duplicate names, invalid digests and unsupported hash identifiers', () => {
  assert.throws(
    () =>
      encode([
        { uri: 'a', text: '' },
        { uri: 'a', text: '' },
      ]),
    /Duplicate/,
  );
  assert.throws(() => encode([{ uri: 'a', text: '', hash: new Uint8Array(31) }]), /hash length/);
  assert.throws(() => encode([{ uri: 'a', text: '', hash: new Uint8Array(32) }]), /checksum/);
  assert.equal(encode([{ uri: 'a', text: '', hashAlgorithm: PdbGuids.sha384 }]).documents[0].hash.length, 48);
  assert.throws(
    () => encode([{ uri: 'a', text: '', hashAlgorithm: '11111111-2222-3333-4444-555555555555' }]),
    /Unsupported/,
  );
});
