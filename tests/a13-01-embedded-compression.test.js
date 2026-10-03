import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { compileToIL } from '@sharpforge/compiler';
import { emitPortablePdb, readPortablePdb, attachPortablePdb, readDebugDirectory, loadSymbols, PdbGuids } from '@sharpforge/symbols';

const compiled = compileToIL('Console.WriteLine(1);', { portablePdb: false });
assert.equal(compiled.success, true);
const text = 'namespace Example { public class Test { public int Value => 42; } }\n'.repeat(100);

test('embedded source shrinks and independent platform decompression preserves bytes', () => {
  const raw = new TextEncoder().encode(text);
  const emitted = emitPortablePdb(compiled.assembly, { sources: [{ uri: 'input.cs', bytes: raw }] });
  const symbols = readPortablePdb(emitted.bytes);
  const record = symbols.custom.find(item => item.kind === PdbGuids.embeddedSource);
  assert(record.bytes.length < raw.length * 0.4);
  assert.equal(new DataView(record.bytes.buffer, record.bytes.byteOffset).getUint32(0, true), raw.length);
  assert.deepEqual(new Uint8Array(inflateRawSync(record.bytes.subarray(4))), raw);
  assert.deepEqual(symbols.documents[0].embedded, raw);
});

test('embedded PDB compresses and remains bound to its assembly identity', () => {
  const emitted = emitPortablePdb(compiled.assembly, { sources: [{ uri: 'input.cs', text }] }, { embedSources: false });
  const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, { embedded: true });
  const record = readDebugDirectory(assembly).find(item => item.kind === 17);
  assert(record.bytes.length < emitted.bytes.length);
  assert.deepEqual(new Uint8Array(inflateRawSync(record.bytes.subarray(8))), emitted.bytes);
  assert.deepEqual(loadSymbols(assembly).id, emitted.id);
});

test('short embedded sources remain raw and byte limits reject decompression early', () => {
  const emitted = emitPortablePdb(compiled.assembly, { sources: [{ uri: 'short.cs', text: 'short' }] });
  const record = readPortablePdb(emitted.bytes).custom.find(item => item.kind === PdbGuids.embeddedSource);
  assert.equal(new DataView(record.bytes.buffer, record.bytes.byteOffset).getUint32(0, true), 0);
  const large = emitPortablePdb(compiled.assembly, { sources: [{ uri: 'input.cs', text }] });
  assert.throws(() => readPortablePdb(large.bytes, { maxSourceBytes: 100 }), /size/);
});
