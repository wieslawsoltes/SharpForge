import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileToIL } from '@sharpforge/compiler';
import { readPE } from '@sharpforge/cil';
import {
  emitPortablePdb,
  readPortablePdb,
  attachPortablePdb,
  readDebugDirectory,
  loadSymbols,
  PdbGuids,
} from '@sharpforge/symbols';

const compiled = compileToIL('Console.WriteLine(1);', { portablePdb: false });
assert.equal(compiled.success, true);
const emitted = emitPortablePdb(compiled.assembly, { sources: [{ uri: 'input.cs', text: 'source' }] });

for (const checksum of ['SHA256', 'SHA384', 'SHA512']) {
  test('debug directory checksum agrees with platform ' + checksum, () => {
    const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, { checksum, embedded: true });
    const entries = readDebugDirectory(assembly);
    assert.deepEqual(
      entries.map((entry) => entry.kind),
      [2, 19, 16, 17],
    );
    const symbols = readPortablePdb(emitted.bytes);
    const zero = emitted.bytes.slice();
    zero.fill(0, symbols.pdbOffset, symbols.pdbOffset + 20);
    const expected = new Uint8Array(createHash(checksum.toLowerCase()).update(zero).digest());
    assert.deepEqual(entries.find((entry) => entry.kind === 19).checksum, expected);
    assert(loadSymbols(assembly).bound);
  });
}

test('attach replaces symbols while preserving unknown directory payloads and an overlay', () => {
  const initial = attachPortablePdb(compiled.assembly, emitted.bytes);
  const pe = readPE(initial, { inspection: true });
  const view = new DataView(initial.buffer);
  const directory = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112) + 6 * 8;
  const start = pe.offsetOf(view.getUint32(directory, true), view.getUint32(directory + 4, true));
  // Preserve an unknown future debug kind with the old checksum payload as its opaque data.
  view.setUint32(start + 28 + 12, 42, true);
  const expectedOpaque = readDebugDirectory(initial)
    .find((entry) => entry.kind === 42)
    .bytes.slice();
  const overlay = new TextEncoder().encode('opaque-overlay\0\u00FF');
  const input = new Uint8Array(initial.length + overlay.length);
  input.set(initial);
  input.set(overlay, initial.length);
  const rebound = attachPortablePdb(input, emitted.bytes, { path: 'replacement.pdb', embedded: true });
  assert.deepEqual(rebound.subarray(rebound.length - overlay.length), overlay);
  const entries = readDebugDirectory(rebound);
  assert.deepEqual(entries.find((entry) => entry.kind === 42).bytes, expectedOpaque);
  assert.equal(entries.filter((entry) => entry.kind === 2).length, 1);
  assert.equal(entries.find((entry) => entry.kind === 2).path, 'replacement.pdb');
  assert(loadSymbols(rebound).bound);
});

test('embedded PDB inflation is lazy, cached and checked against the caller budget', () => {
  const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, { embedded: true });
  const entry = readDebugDirectory(assembly).find((item) => item.kind === 17);
  assert(Object.getOwnPropertyDescriptor(entry, 'pdb').get);
  assert.equal(entry.pdb, entry.pdb);
  const corrupted = assembly.slice();
  corrupted[entry.offset + 8] = 7; // Invalid reserved DEFLATE block.
  const lazy = readDebugDirectory(corrupted).find((item) => item.kind === 17);
  assert.throws(() => lazy.pdb, /Reserved/);
  assert.throws(() => readDebugDirectory(assembly, { maxBytes: emitted.bytes.length - 1 }), /oversized/);
  assert.throws(() => loadSymbols(assembly, null, { maxBytes: emitted.bytes.length - 1 }), /oversized/);
});

test('path limit is one documented boundary and reproducible/checksum entries are optional', () => {
  const assembly = attachPortablePdb(compiled.assembly, emitted.bytes, {
    path: 'x'.repeat(4096),
    checksum: false,
    reproducible: false,
  });
  assert.equal(readDebugDirectory(assembly)[0].path.length, 4096);
  assert.deepEqual(
    readDebugDirectory(assembly).map((entry) => entry.kind),
    [2],
  );
  assert.throws(() => attachPortablePdb(compiled.assembly, emitted.bytes, { path: 'x'.repeat(4097) }), /PDB path/);
  assert.throws(() => attachPortablePdb(compiled.assembly, emitted.bytes, { path: 'bad\0path' }), /PDB path/);
  assert.throws(() => attachPortablePdb(compiled.assembly, emitted.bytes, { checksum: 'MD5' }), /Unsupported/);
});

for (const size of [0, 1, 111, 112, 127, 128, 129, 1000]) {
  for (const name of ['sha384', 'sha512'])
    test('source ' + name + ' hashing matches platform at length ' + size, () => {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index * 73);
      const output = emitPortablePdb(compiled.assembly, {
        sources: [{ uri: 'hash.cs', bytes, hashAlgorithm: PdbGuids[name] }],
      });
      assert.deepEqual(
        readPortablePdb(output.bytes).documents[0].hash,
        new Uint8Array(createHash(name).update(bytes).digest()),
      );
    });
}

test('Node Buffer inputs retain their identities across repeated checksum verification and attachment', () => {
  const input = Buffer.from(emitted.bytes);
  const expected = Buffer.from(input);
  const assembly = attachPortablePdb(compiled.assembly, input, { embedded: true });
  assert.deepEqual(input, expected);
  const first = loadSymbols(assembly, input);
  assert.deepEqual(input, expected);
  const second = loadSymbols(assembly, input);
  assert.equal(first.idHex, second.idHex);
  assert.deepEqual(input, expected);
});

test('attachment honors nondefault PE alignments and only counts section growth as code', () => {
  const input = compiled.assembly.slice();
  const original = readPE(input, { inspection: true });
  const header = new DataView(input.buffer);
  header.setUint32(original.optionalStart + 32, 4096, true);
  header.setUint32(original.optionalStart + 36, 256, true);
  const codeSize = header.getUint32(original.optionalStart + 4, true);
  const rawSize = original.sections.at(-1).size;
  const assembly = attachPortablePdb(input, emitted.bytes, { embedded: true });
  const attached = readPE(assembly, { inspection: true });
  const updated = new DataView(assembly.buffer);
  assert.equal(attached.sections.at(-1).size % 256, 0);
  assert.equal(updated.getUint32(attached.optionalStart + 56, true) % 4096, 0);
  assert.equal(updated.getUint32(attached.optionalStart + 4, true), codeSize + attached.sections.at(-1).size - rawSize);
  assert(loadSymbols(assembly).bound);
});
