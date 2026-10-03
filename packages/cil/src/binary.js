import { deterministicContentId } from './binary/content-id.js';
/** Bounded little-endian primitives shared by PE, CLI metadata and CIL codecs. */
export class CilError extends Error {
  constructor(message, offset) { super(offset === undefined ? message : `${message} at 0x${offset.toString(16)}`); this.name = 'CilError'; this.offset = offset; }
}
export function align(value, boundary = 4) { return Math.ceil(value / boundary) * boundary; }
export class Writer {
  constructor(capacity = 256) { this.buffer = new Uint8Array(capacity); this.length = 0; this.view = new DataView(this.buffer.buffer); }
  reserve(count) { const end = this.length + count; if (!Number.isSafeInteger(end) || end > 128 * 1024 * 1024) throw new CilError('Output size limit exceeded'); if (end > this.buffer.length) { const next = new Uint8Array(Math.max(end, this.buffer.length * 2)); next.set(this.buffer); this.buffer = next; this.view = new DataView(next.buffer); } }
  u8(v) { this.reserve(1); this.view.setUint8(this.length, v); this.length++; return this; }
  u16(v) { this.reserve(2); this.view.setUint16(this.length, v, true); this.length += 2; return this; }
  u32(v) { this.reserve(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; return this; }
  f32(v) { this.reserve(4); this.view.setFloat32(this.length, v, true); this.length += 4; return this; }
  i64(v) { this.reserve(8); this.view.setBigInt64(this.length, BigInt(v), true); this.length += 8; return this; }
  f64(v) { this.reserve(8); this.view.setFloat64(this.length, v, true); this.length += 8; return this; }
  bytes(v) { this.reserve(v.length); this.buffer.set(v, this.length); this.length += v.length; return this; }
  zero(n) { this.reserve(n); this.buffer.fill(0, this.length, this.length + n); this.length += n; return this; }
  pad(n = 4) { return this.zero(align(this.length, n) - this.length); }
  patch32(at, value) { if (at < 0 || at + 4 > this.length) throw new CilError('Invalid patch offset'); this.view.setUint32(at, value >>> 0, true); }
  compressed(value) { if (!Number.isInteger(value) || value < 0 || value > 0x1fffffff) throw new CilError('Invalid compressed integer'); if (value <= 0x7f) return this.u8(value); if (value <= 0x3fff) return this.u8((value >>> 8) | 0x80).u8(value); return this.u8((value >>> 24) | 0xc0).u8(value >>> 16).u8(value >>> 8).u8(value); }
  finish() { return this.buffer.slice(0, this.length); }
}
export class Reader {
  constructor(bytes, offset = 0, length = bytes.length - offset) { if (!(bytes instanceof Uint8Array) || offset < 0 || length < 0 || offset + length > bytes.length) throw new CilError('Invalid binary range'); this.bytes = bytes; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.position = offset; this.end = offset + length; }
  need(n) { if (!Number.isSafeInteger(n) || n < 0 || this.position + n > this.end) throw new CilError('Truncated binary data', this.position); }
  u8() { this.need(1); return this.bytes[this.position++]; }
  u16() { this.need(2); const v = this.view.getUint16(this.position, true); this.position += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.position, true); this.position += 4; return v; }
  i32() { return this.u32() | 0; }
  f32() { this.need(4); const v = this.view.getFloat32(this.position, true); this.position += 4; return v; }
  i64() { this.need(8); const v = this.view.getBigInt64(this.position, true); this.position += 8; return v; }
  signedCompressed() { const at=this.position,v=this.compressed(),bits=(this.position-at===1?7:this.position-at===2?14:29); return (v>>>1) - ((v&1)?2**(bits-1):0); }
  f64() { this.need(8); const v = this.view.getFloat64(this.position, true); this.position += 8; return v; }
  take(n) { this.need(n); const v = this.bytes.subarray(this.position, this.position + n); this.position += n; return v; }
  compressed() { const b = this.u8(); if (!(b & 0x80)) return b; if ((b & 0xc0) === 0x80) return ((b & 0x3f) << 8) | this.u8(); if ((b & 0xe0) === 0xc0) return ((b & 0x1f) * 0x1000000) + (this.u8() << 16) + (this.u8() << 8) + this.u8(); throw new CilError('Invalid compressed integer', this.position - 1); }
}
export function utf8(text) { return new TextEncoder().encode(text); }
export function text(bytes) { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
export function equalBytes(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
/** Deterministic SHA-256-derived UUID (16 bytes), using the standard content-ID bit layout. */
export function buildId(bytes) { return deterministicContentId(bytes).id; }
