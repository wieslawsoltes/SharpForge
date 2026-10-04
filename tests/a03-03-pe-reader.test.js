import test from 'node:test';
import assert from 'node:assert/strict';
import { MetadataBuilder, Writer, writePE, readPE, CorFlags, PEDirectoryNames } from '@sharpforge/cil';

function image(options) {
  const builder = new MetadataBuilder('Reader');
  const metadata = builder.finish();
  return writePE(new Writer().zero(72).bytes(metadata).finish(), 72, metadata.length, 0, options);
}

test('A03 PE reader exposes all data and CLI directories without executing input', () => {
  const bytes = image();
  const pe = readPE(bytes, { inspection: true });
  assert.equal(pe.dataDirectories.length, 16);
  assert.deepEqual(pe.dataDirectories.map(item => item.name), PEDirectoryNames);
  assert.equal(pe.directories.cliHeader.rva, 0x2000);
  assert.equal(pe.imageKind, 'ILOnly');
  assert.equal(pe.corFlags, CorFlags.ILOnly);
  const cliOffset = pe.offsetOf(pe.directories.cliHeader.rva);
  const view = new DataView(bytes.buffer);
  view.setUint32(cliOffset + 16, 0, true);
  assert.equal(readPE(bytes, { inspection: true }).imageKind, 'MixedMode');
  assert.throws(() => readPE(bytes), /IL-only/);
  view.setUint32(cliOffset + 16, CorFlags.ILOnly, true);
  view.setUint32(cliOffset + 64, pe.directories.cliHeader.rva + 72, true);
  view.setUint32(cliOffset + 68, 16, true);
  // Point at a temporary R2R signature in unused CLI header bytes after reading metadata.
  const r2rRva = pe.directories.cliHeader.rva + 40;
  view.setUint32(cliOffset + 64, r2rRva, true);
  view.setUint32(cliOffset + 40, 0x00525452, true);
  assert.equal(readPE(bytes, { inspection: true }).imageKind, 'ReadyToRun');
  assert.deepEqual(readPE(bytes, { inspection: true }).managedNativeHeader, { rva: r2rRva, size: 16 });
});

test('A03 PE header sizes, directory counts and RVA arithmetic are bounded', () => {
  const bytes = image();
  const pe = readPE(bytes);
  for (const [offset, value] of [[pe.optionalStart + 92, 65], [pe.optionalStart + 92, 14]]) {
    const malformed = bytes.slice();
    new DataView(malformed.buffer).setUint32(offset, value, true);
    assert.throws(() => readPE(malformed), /directories|directory/);
  }
  assert.throws(() => pe.offsetOf(0xffffffff, 2), /RVA range/);
  assert.throws(() => pe.offsetOf(-1), /RVA range/);
  assert.throws(() => readPE(bytes.subarray(0, 200)), /range|Truncated/);
  assert.throws(() => readPE(bytes, { maxBytes: 1 }), /size limit/);
});
