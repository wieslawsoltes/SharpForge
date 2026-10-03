import { Reader, Writer, readPE, text, utf8, align } from '@sharpforge/cil';
import { rejectUnsupportedSymbolFormat } from './symbol-format.js';
import { fail } from './contracts.js';
import { sha256 } from './hash.js';
import { inflateRaw, deflateStored } from './deflate.js';
import { readPortablePdb } from './pdb-reader.js';
export function readDebugDirectory(assembly) {
  const pe = readPE(assembly, { inspection: true }),
    v = new DataView(pe.bytes.buffer, pe.bytes.byteOffset, pe.bytes.byteLength),
    dir = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112) + 6 * 8,
    rva = v.getUint32(dir, true),
    size = v.getUint32(dir + 4, true);
  if (!size) return [];
  if (size % 28 || size > 28 * 1024) fail('Invalid debug directory size');
  const r = new Reader(pe.bytes, pe.offsetOf(rva, size), size),
    entries = [];
  while (r.position < r.end) {
    const characteristics = r.u32(),
      stamp = r.u32(),
      major = r.u16(),
      minor = r.u16(),
      kind = r.u32(),
      length = r.u32(),
      dataRva = r.u32(),
      offset = r.u32();
    if (offset + length > pe.bytes.length) fail('Truncated debug entry');
    const bytes = pe.bytes.subarray(offset, offset + length),
      e = { kind, stamp, major, minor, bytes, offset };
    if (kind === 2) {
      rejectUnsupportedSymbolFormat(bytes);
      if (bytes.length < 25 || text(bytes.subarray(0, 4)) !== 'RSDS') fail('Invalid CodeView record');
      e.guid = bytes.slice(4, 20);
      e.age = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20, true);
      const zero = bytes.indexOf(0, 24);
      if (zero < 0) fail('Unterminated PDB path');
      e.path = text(bytes.subarray(24, zero));
      e.id = new Writer().bytes(e.guid).u32(stamp).finish();
    } else if (kind === 17) {
      const er = new Reader(bytes);
      if (er.u32() !== 0x4244504d) fail('Invalid embedded Portable PDB signature');
      const n = er.u32();
      e.pdb = inflateRaw(er.take(er.end - er.position), n);
    } else if (kind === 19) {
      const zero = bytes.indexOf(0);
      if (zero < 0) fail('Invalid PDB checksum');
      e.algorithm = text(bytes.subarray(0, zero));
      e.checksum = bytes.slice(zero + 1);
    }
    entries.push(e);
  }
  return entries;
}
export function attachPortablePdb(assembly, pdb, { path = 'Application.pdb', embedded = false, checksum = true } = {}) {
  if (pdb instanceof ArrayBuffer) pdb = new Uint8Array(pdb);
  if (typeof path !== 'string' || path.includes('\0') || path.length > 32768) fail('Invalid PDB path');
  if (typeof path !== 'string' || path.includes('\0') || path.length > 4096) fail('Invalid symbol path');
  const parsed = readPortablePdb(pdb),
    pe = readPE(assembly, { inspection: true }),
    entries = readDebugDirectory(assembly);
  if (entries.length) fail('Assembly already contains a debug directory');
  const last = [...pe.sections].sort((a, b) => a.offset - b.offset).at(-1);
  if (last.offset + last.size !== pe.bytes.length) fail('Cannot append symbols to PE with an overlay');
  const payloads = [
    {
      kind: 2,
      major: 0x100,
      minor: 0x504d,
      stamp: new DataView(parsed.id.buffer, parsed.id.byteOffset).getUint32(16, true),
      bytes: new Writer().bytes(utf8('RSDS')).bytes(parsed.id.subarray(0, 16)).u32(1).bytes(utf8(path)).u8(0).finish(),
    },
  ];
  if (embedded)
    payloads.push({
      kind: 17,
      major: 0x100,
      minor: 0x100,
      stamp: 0,
      bytes: new Writer().u32(0x4244504d).u32(pdb.length).bytes(deflateStored(pdb)).finish(),
    });
  if (checksum) {
    const zero = pdb.slice(),
      pdbAt = parsed.metadata.streams.get('#Pdb').byteOffset - pdb.byteOffset;
    zero.fill(0, pdbAt, pdbAt + 20);
    payloads.push({
      kind: 19,
      major: 1,
      minor: 0,
      stamp: 0,
      bytes: new Writer().bytes(utf8('SHA256\0')).bytes(sha256(zero)).finish(),
    });
  }
  const offset = align(pe.bytes.length, 4),
    w = new Writer()
      .bytes(pe.bytes)
      .zero(offset - pe.bytes.length)
      .zero(28 * payloads.length);
  payloads.forEach((e, i) => {
    w.pad();
    const at = w.length;
    w.bytes(e.bytes);
    const p = new Writer()
      .u32(0)
      .u32(e.stamp)
      .u16(e.major)
      .u16(e.minor)
      .u32(e.kind)
      .u32(e.bytes.length)
      .u32(last.rva + at - last.offset)
      .u32(at);
    w.buffer.set(p.finish(), offset + i * 28);
  });
  const virtualSize = w.length - last.offset;
  w.pad(512);
  const out = w.finish(),
    v = new DataView(out.buffer);
  v.setUint32(last.headerOffset + 8, virtualSize, true);
  v.setUint32(last.headerOffset + 16, out.length - last.offset, true);
  v.setUint32(pe.optionalStart + 56, align(last.rva + virtualSize, 8192), true);
  v.setUint32(pe.optionalStart + 4, out.length - 512, true);
  const dir = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112) + 6 * 8;
  v.setUint32(dir, last.rva + offset - last.offset, true);
  v.setUint32(dir + 4, 28 * payloads.length, true);
  return out;
}
