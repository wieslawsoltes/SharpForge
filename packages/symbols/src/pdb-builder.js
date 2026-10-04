import { Writer, utf8, metadataIndexWidth, metadataSchemas } from '@sharpforge/cil';
import { sha256, hex } from './hash.js';
import { guidBytes } from './contracts.js';
export class PortablePdbBuilder {
  constructor() {
    this.strings = new Writer().u8(0);
    this.blobs = new Writer().u8(0);
    this.guids = new Writer();
    this.sm = new Map([['', 0]]);
    this.bm = new Map();
    this.gm = new Map();
    this.rows = {};
  }
  string(s) {
    if (this.sm.has(s)) return this.sm.get(s);
    const at = this.strings.length;
    this.strings.bytes(utf8(s)).u8(0);
    this.sm.set(s, at);
    return at;
  }
  blob(b) {
    if (!b.length) return 0;
    const key = hex(b);
    if (this.bm.has(key)) return this.bm.get(key);
    const at = this.blobs.length;
    this.blobs.compressed(b.length).bytes(b);
    this.bm.set(key, at);
    return at;
  }
  guid(s) {
    if (!s) return 0;
    if (this.gm.has(s)) return this.gm.get(s);
    const n = this.guids.length / 16 + 1;
    this.guids.bytes(guidBytes(s));
    this.gm.set(s, n);
    return n;
  }
  add(t, r) {
    const a = (this.rows[t] ??= []);
    a.push(r);
    return a.length;
  }
  finish(external, entryPoint) {
    const pdb = new Writer().zero(20).u32(entryPoint);
    let lo = 0,
      hi = 0;
    for (const [id, n] of Object.entries(external))
      if (n) {
        if (+id < 32) lo |= 1 << +id;
        else hi |= 1 << (+id - 32);
      }
    pdb.u32(lo).u32(hi);
    for (let i = 0; i < 64; i++) if (external[i]) pdb.u32(external[i]);
    const counts = { ...external, ...Object.fromEntries(Object.entries(this.rows).map(([t, r]) => [t, r.length])) },
      flags =
        (this.strings.length >= 65536 ? 1 : 0) |
        (this.guids.length >= 65536 ? 2 : 0) |
        (this.blobs.length >= 65536 ? 4 : 0),
      tb = new Writer().u32(0).u8(2).u8(0).u8(flags).u8(1);
    let high = 0;
    for (const t of Object.keys(this.rows)) high |= 1 << (+t - 32);
    tb.u32(0)
      .u32(high)
      .u32(0)
      .u32((1 << (50 - 32)) | (1 << (54 - 32)) | (1 << (55 - 32)));
    for (let t = 48; t <= 55; t++) if (this.rows[t]) tb.u32(this.rows[t].length);
    for (let t = 48; t <= 55; t++)
      for (const row of this.rows[t] ?? [])
        row.forEach((v, i) => (metadataIndexWidth(metadataSchemas[t][i], counts, flags) === 2 ? tb.u16(v) : tb.u32(v)));
    const streams = [
        ['#Pdb', pdb.finish()],
        ['#~', tb.finish()],
        ['#Strings', this.strings.finish()],
        ['#GUID', this.guids.finish()],
        ['#Blob', this.blobs.finish()],
      ],
      root = new Writer()
        .u32(0x424a5342)
        .u16(1)
        .u16(1)
        .u32(0)
        .u32(12)
        .bytes(utf8('PDB v1.0\0\0\0\0'))
        .u16(0)
        .u16(streams.length),
      patch = [];
    for (const [n, b] of streams) {
      patch.push(root.length);
      root.u32(0).u32(b.length).bytes(utf8(n)).u8(0).pad();
    }
    let pdbOffset;
    streams.forEach(([name, b], i) => {
      root.pad();
      root.patch32(patch[i], root.length);
      if (name === '#Pdb') pdbOffset = root.length;
      root.bytes(b);
    });
    const bytes = root.finish(),
      hash = sha256(bytes),
      id = hash.slice(0, 20);
    id[7] = (id[7] & 15) | 0x40;
    id[8] = (id[8] & 63) | 0x80;
    id[19] |= 0x80;
    bytes.set(id, pdbOffset);
    return { bytes, id, checksum: hash };
  }
}
