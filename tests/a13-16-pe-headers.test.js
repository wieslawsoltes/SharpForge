import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, CilError, CorFlags, inspectPE, readPE } from '@sharpforge/cil';
import { peFixture, extraDirectoryFixture, viewOf } from './fixtures/pe-inspection/input.mjs';

for (const [platform, format, machine] of [['anycpu', 'PE32', 0x14c], ['x64', 'PE32+', 0x8664]]) {
  test(`owned ${format} headers, sections and directories expose exact scalar facts`, () => {
    const { bytes } = peFixture({ platform, certificate: new Uint8Array([1, 2, 3, 4]) });
    const pe = readPE(bytes);
    const view = viewOf(bytes);
    view.setUint32(pe.peHeaderOffset + 8, 0xfedcba98, true);
    view.setUint32(pe.peHeaderOffset + 12, 123, true);
    view.setUint32(pe.peHeaderOffset + 16, 7, true);
    view.setUint32(pe.sections[0].headerOffset + 24, 345, true);
    view.setUint32(pe.sections[0].headerOffset + 28, 456, true);
    view.setUint16(pe.sections[0].headerOffset + 32, 12, true);
    view.setUint16(pe.sections[0].headerOffset + 34, 13, true);
    const result = inspectPE(bytes);
    assert.equal(result.format, 'sharpforge.pe-inspection');
    assert.equal(result.version, 1);
    assert.equal(result.headers.optional.format, format);
    assert.equal(result.headers.coff.machine, machine);
    assert.equal(result.headers.coff.timestamp, 0xfedcba98);
    assert.equal(result.headers.coff.pointerToSymbolTable, 123);
    assert.equal(result.headers.coff.numberOfSymbols, 7);
    assert.equal(result.sections.length, 2);
    assert.deepEqual(result.sections.map(section => section.name), ['.text', '.data']);
    assert.equal(result.sections[0].pointerToRelocations, 345);
    assert.equal(result.sections[0].pointerToLineNumbers, 456);
    assert.equal(result.sections[0].numberOfRelocations, 12);
    assert.equal(result.sections[0].numberOfLineNumbers, 13);
    assert.equal(result.directories.length, 16);
    const certificate = result.directories.find(entry => entry.name === 'certificate');
    assert.equal(certificate.addressKind, 'file-offset');
    assert.equal(certificate.address, certificate.fileOffset);
    assert.equal(certificate.status, 'mapped');
    assert.equal(result.cli.metadataDirectory.status, 'mapped');
    assert.equal(result.cli.headerSize, 72);
    const snapshot = JSON.stringify(result);
    bytes.fill(0);
    assert.equal(JSON.stringify(result), snapshot);
  });
}

test('all UInt64 optional-header values retain exact bits beyond Number precision', () => {
  const { bytes } = peFixture({ platform: 'x64' });
  const pe = readPE(bytes);
  const values = { imageBase: [24, 0x123456789abc0000n], sizeOfStackReserve: [72, 0xfedcba9876543210n],
    sizeOfStackCommit: [80, 0x8000000000000001n], sizeOfHeapReserve: [88, 0xffffffffffffffffn],
    sizeOfHeapCommit: [96, 0x20000000000001n] };
  const view = viewOf(bytes);
  for (const [offset, value] of Object.values(values)) view.setBigUint64(pe.optionalStart + offset, value, true);
  const result = inspectPE(bytes);
  for (const [name, [, value]] of Object.entries(values)) assert.equal(result.headers.optional[name], '0x' + value.toString(16));
  assert.equal(result.headers.optional.baseOfData, null);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('CorFlags retain unknown bits and signing facts do not claim signature verification', () => {
  const { bytes } = peFixture({ publicKey: new Uint8Array([1, 2, 3]), signature: new Uint8Array(8),
    corFlags: CorFlags.ILOnly | CorFlags.ILLibrary | CorFlags.StrongNameSigned | 0x80000000 });
  const result = inspectPE(bytes);
  assert.deepEqual(result.cli.flags.names, ['ILOnly', 'ILLibrary', 'StrongNameSigned']);
  assert.equal(result.cli.flags.unknownBits, 0x80000000);
  assert.equal(result.strongName.publicKeyFlag, true);
  assert.equal(result.strongName.publicKey, '010203');
  assert.equal(result.strongName.signatureState, 'zero-filled');
  assert.equal(result.strongName.signature, '0000000000000000');
  assert.equal(result.strongName.signedFlag, true);
  assert.equal(result.strongName.verification, 'not-performed');
  bytes[result.strongName.directory.fileOffset + 2] = 0x80;
  assert.equal(inspectPE(bytes).strongName.signatureState, 'nonzero');
  assert.equal(inspectPE(bytes, { maxStrongNameBytes: 11 }).strongName.verification, 'not-performed');
  assert.throws(() => inspectPE(bytes, { maxStrongNameBytes: 10 }), /strong-name byte limit/);
});

test('extra advertised directories survive and unmapped unused directories are explicit', () => {
  const { bytes } = extraDirectoryFixture();
  const result = inspectPE(bytes);
  assert.equal(result.headers.optional.directoryCount, 17);
  assert.equal(result.directories[16].name, 'directory16');
  assert.equal(result.directories[16].status, 'mapped');
  const pe = readPE(bytes);
  const view = viewOf(bytes);
  view.setUint32(pe.optionalStart + 96, 0xffffff00, true);
  view.setUint32(pe.optionalStart + 100, 8, true);
  const invalid = inspectPE(bytes).directories[0];
  assert.equal(invalid.status, 'unmapped');
  assert.match(invalid.reason, /RVA/);
  assert.equal(inspectPE(bytes).directories[1].status, 'empty');
});

test('fifteen advertised directories preserve reader compatibility without inventing a sixteenth output entry', () => {
  const { bytes } = peFixture();
  const pe = readPE(bytes);
  viewOf(bytes).setUint32(pe.optionalStart + 92, 15, true);
  assert.equal(readPE(bytes).dataDirectories.length, 16);
  assert.equal(inspectPE(bytes).headers.optional.directoryCount, 15);
  assert.equal(inspectPE(bytes).directories.length, 15);
  assert.equal(inspectPE(bytes).directories.at(-1).name, 'cliHeader');
});

test('unmapped signing reservations remain explicit and large bounded scans check cancellation', () => {
  const { bytes, cliOffset } = peFixture({ signature: new Uint8Array(8) });
  viewOf(bytes).setUint32(cliOffset + 32, 0xffffff00, true);
  const result = inspectPE(bytes);
  assert.equal(result.strongName.directory.status, 'unmapped');
  assert.equal(result.strongName.signatureState, 'unmapped');
  assert.equal(result.strongName.signature, null);
  assert.equal(result.strongName.verification, 'not-performed');
  const large = peFixture({ signature: new Uint8Array(65536) });
  let checks = 0;
  assert.throws(() => inspectPE(large.bytes, { maxStrongNameBytes: 65536,
    signal: { get aborted() { return ++checks > 24; } } }), /cancelled/);
});

test('PE snapshots are opt-in on full and paged summaries; outer signals take precedence', () => {
  const { bytes } = peFixture();
  const inspector = new AssemblyInspector(bytes);
  assert.equal(inspector.summary().pe, undefined);
  assert.equal(inspector.summary().imageKind, 'ILOnly');
  assert.deepEqual(inspector.summary({ includePE: true }).pe, inspectPE(bytes));
  assert.deepEqual(inspector.summary({ includePE: true, methodLimit: 1 }).pe, inspectPE(bytes));
  const live = new AbortController().signal;
  for (const page of [{}, { methodLimit: 1 }]) {
    assert.throws(() => inspector.summary({ ...page, includePE: true, signal: AbortSignal.abort() }), /cancelled/);
    assert.throws(() => inspector.summary({ ...page, includePE: true, peOptions: { signal: AbortSignal.abort() } }), /cancelled/);
    assert.doesNotThrow(() => inspector.summary({ ...page, includePE: true,
      signal: live, peOptions: { signal: AbortSignal.abort() } }));
  }
  assert.throws(() => inspector.summary({ includePE: 1 }), /includePE/);
  for (const peOptions of [null, [], false]) assert.throws(() => inspector.summary({ includePE: true, peOptions }), CilError);
});

test('invalid PE input, byte budgets, truncated optional headers and cancellation reject deterministically', () => {
  const { bytes } = peFixture();
  assert.equal(inspectPE(bytes, { maxBytes: bytes.length }).bytes, bytes.length);
  assert.throws(() => inspectPE(bytes, { maxBytes: bytes.length - 1 }), /size limit/);
  for (const options of [null, [], { maxBytes: -1 }, { maxDebugBytes: Infinity }, { maxStrongNameBytes: 1.5 }])
    assert.throws(() => inspectPE(bytes, options), CilError);
  for (const input of [null, [], new Uint8Array(1), bytes.subarray(0, 200)]) assert.throws(() => inspectPE(input), CilError);
  assert.throws(() => inspectPE(bytes, { signal: AbortSignal.abort() }), /cancelled/);
  let checks = 0;
  assert.throws(() => inspectPE(bytes, { signal: { get aborted() { return ++checks > 5; } } }), /cancelled/);
  const shortened = bytes.slice();
  const pe = readPE(bytes);
  viewOf(shortened).setUint16(pe.peHeaderOffset + 20, 80, true);
  assert.throws(() => inspectPE(shortened), /Truncated/);
  const nativeOnly = bytes.slice();
  viewOf(nativeOnly).setUint32(pe.optionalStart + 96 + 14 * 8 + 4, 0, true);
  assert.throws(() => inspectPE(nativeOnly), /Not a managed CLI image/);
});
