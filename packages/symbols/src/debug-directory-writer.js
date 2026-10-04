import { Writer, readPE, utf8, align, peChecksum } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { deflateRaw } from './deflate.js';
import { readPortablePdb } from './pdb-reader.js';
import { readDebugDirectory } from './debug-directory-reader.js';
import { pdbChecksum } from './pdb-checksum.js';

function payloadsFor(pdb, parsed, options) {
  const { path, embedded, checksum, reproducible } = options;
  const payloads = [
    {
      kind: 2,
      major: 0x100,
      minor: 0x504d,
      stamp: new DataView(parsed.id.buffer, parsed.id.byteOffset).getUint32(16, true),
      bytes: new Writer().bytes(utf8('RSDS')).bytes(parsed.id.subarray(0, 16)).u32(1).bytes(utf8(path)).u8(0).finish(),
    },
  ];
  if (checksum) {
    const algorithm = checksum === true ? 'SHA256' : checksum;
    payloads.push({
      kind: 19,
      major: 1,
      minor: 0,
      stamp: 0,
      bytes: new Writer()
        .bytes(utf8(algorithm + '\0'))
        .bytes(pdbChecksum(parsed, algorithm))
        .finish(),
    });
  }
  if (reproducible) payloads.push({ kind: 16, major: 0, minor: 0, stamp: 0, bytes: new Uint8Array() });
  if (embedded)
    payloads.push({
      kind: 17,
      major: 0x100,
      minor: 0x100,
      stamp: 0,
      bytes: new Writer().u32(0x4244504d).u32(pdb.length).bytes(deflateRaw(pdb)).finish(),
    });
  return payloads;
}

function layout(pe) {
  const view = new DataView(pe.bytes.buffer, pe.bytes.byteOffset, pe.bytes.byteLength);
  const fileAlignment = view.getUint32(pe.optionalStart + 36, true);
  const sectionAlignment = view.getUint32(pe.optionalStart + 32, true);
  for (const alignment of [fileAlignment, sectionAlignment]) {
    if (!alignment || alignment > 0x10000000 || alignment & (alignment - 1)) fail('Invalid PE alignment');
  }
  const section = [...pe.sections].sort((left, right) => left.offset - right.offset).at(-1);
  if (pe.sections.some((item) => item.rva > section.rva))
    fail('Last PE file section must also be last virtual section');
  return { section, fileAlignment, sectionAlignment, overlayOffset: section.offset + section.size };
}

function appendDirectory(pe, payloads, target) {
  const { section, overlayOffset, fileAlignment } = target;
  const directoryOffset = align(Math.max(overlayOffset, section.offset + section.virtualSize), 4);
  const writer = new Writer().bytes(pe.bytes.subarray(0, overlayOffset)).zero(directoryOffset - overlayOffset);
  writer.zero(payloads.length * 28);
  for (const [index, entry] of payloads.entries()) {
    writer.pad();
    const offset = entry.bytes.length ? writer.length : 0;
    writer.bytes(entry.bytes);
    const header = new Writer()
      .u32(entry.characteristics ?? 0)
      .u32(entry.stamp)
      .u16(entry.major)
      .u16(entry.minor)
      .u32(entry.kind)
      .u32(entry.bytes.length)
      .u32(offset ? section.rva + offset - section.offset : 0)
      .u32(offset);
    writer.buffer.set(header.finish(), directoryOffset + index * 28);
  }
  const virtualSize = writer.length - section.offset;
  writer.pad(fileAlignment);
  const rawSize = writer.length - section.offset;
  const overlayShift = writer.length - overlayOffset;
  writer.bytes(pe.bytes.subarray(overlayOffset));
  return { bytes: writer.finish(), virtualSize, rawSize, overlayShift, directoryOffset };
}

function patchImage(pe, image, target, entryCount) {
  const { section, sectionAlignment, overlayOffset } = target;
  const view = new DataView(image.bytes.buffer);
  view.setUint32(section.headerOffset + 8, image.virtualSize, true);
  view.setUint32(section.headerOffset + 16, image.rawSize, true);
  view.setUint32(pe.optionalStart + 56, align(section.rva + image.virtualSize, sectionAlignment), true);
  view.setUint32(pe.optionalStart + 64, 0, true);
  const characteristics = view.getUint32(section.headerOffset + 36, true);
  const sizeField = characteristics & 0x20 ? 4 : characteristics & 0x40 ? 8 : null;
  if (sizeField !== null) {
    const offset = pe.optionalStart + sizeField;
    view.setUint32(offset, view.getUint32(offset, true) + image.rawSize - section.size, true);
  }
  const dataStart = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112);
  const securityOffset = view.getUint32(dataStart + 4 * 8, true);
  if (securityOffset >= overlayOffset && securityOffset)
    view.setUint32(dataStart + 4 * 8, securityOffset + image.overlayShift, true);
  const coffSymbols = view.getUint32(pe.optionalStart - 12, true);
  if (coffSymbols >= overlayOffset && coffSymbols)
    view.setUint32(pe.optionalStart - 12, coffSymbols + image.overlayShift, true);
  view.setUint32(dataStart + 6 * 8, section.rva + image.directoryOffset - section.offset, true);
  view.setUint32(dataStart + 6 * 8 + 4, entryCount * 28, true);
  if (pe.checksum) view.setUint32(pe.optionalStart + 64, peChecksum(image.bytes), true);
  return image.bytes;
}

/** Attach/rebind standard symbols, preserving other debug kinds and overlay bytes. Paths allow at most 4096 UTF-16 code units. */
export function attachPortablePdb(assembly, input, options = {}) {
  const settings = { path: 'Application.pdb', embedded: false, checksum: true, reproducible: true, ...options };
  if (typeof settings.path !== 'string' || settings.path.includes('\0') || settings.path.length > 4096)
    fail('Invalid PDB path');
  const pdb = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const parsed = readPortablePdb(pdb);
  const pe = readPE(assembly, { inspection: true });
  const preserved = readDebugDirectory(assembly).filter((entry) => ![2, 16, 17, 19].includes(entry.kind));
  const payloads = [...payloadsFor(pdb, parsed, settings), ...preserved];
  if (payloads.length > 1024) fail('Debug directory entry limit exceeded');
  const target = layout(pe);
  return patchImage(pe, appendDirectory(pe, payloads, target), target, payloads.length);
}
