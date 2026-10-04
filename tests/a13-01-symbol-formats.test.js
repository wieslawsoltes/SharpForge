import test from 'node:test';
import assert from 'node:assert/strict';
import { readPortablePdb, PortablePdbBuilder, SymbolError } from '@sharpforge/symbols';

for (const [signature, format] of [
  ['Microsoft C/C++ MSF 7.00\r\n\x1aDS\0', 'Windows PDB (MSF 7.00)'],
  ['Microsoft C/C++ program database 2.00\r\n\x1aJG\0', 'Windows PDB (MSF 2.00)'],
  ['NB09', 'legacy embedded CodeView NB09'],
  ['NB10', 'legacy embedded CodeView NB10'],
  ['NB11', 'legacy embedded CodeView NB11'],
]) {
  test('symbol format rejection identifies ' + format, () => {
    const bytes = new TextEncoder().encode(signature);
    const storage = new Uint8Array(bytes.length + 8);
    storage.set(bytes, 4);
    assert.throws(() => readPortablePdb(storage.subarray(4, 4 + bytes.length)), error => {
      assert(error instanceof SymbolError);
      assert.equal(error.code, 'SF_SYMBOL_UNSUPPORTED_FORMAT');
      assert.equal(error.format, format);
      return true;
    });
  });
}

test('format detection accepts Portable PDB and does not classify truncated prefixes', () => {
  const portable = new PortablePdbBuilder().finish({}, 0).bytes;
  assert.equal(readPortablePdb(portable).format, 'Portable PDB');
  assert.throws(() => readPortablePdb(new TextEncoder().encode('Microsoft C/C++ MSF 7.0')), error => {
    assert.notEqual(error.code, 'SF_SYMBOL_UNSUPPORTED_FORMAT');
    return true;
  });
});
