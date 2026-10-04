import { Writer, utf8 } from '@sharpforge/cil';
import { hex } from './hash.js';
import { guidBytes } from './contracts.js';
import { finishPortablePdb } from './pdb-serialization.js';
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
    return finishPortablePdb(this, external, entryPoint);
  }
}
