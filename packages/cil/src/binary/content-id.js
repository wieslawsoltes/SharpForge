import { sha256 } from './hash.js';

/** Derive an SRM-compatible content GUID and deterministic timestamp from SHA-256 bytes. */
export function deterministicContentId(bytes) {
  const hash = sha256(bytes), id = hash.slice(0, 16);
  id[7] = (id[7] & 15) | 0x40;
  id[8] = (id[8] & 63) | 0x80;
  const timestamp = (new DataView(hash.buffer, hash.byteOffset).getUint32(16, true) | 0x80000000) >>> 0;
  return { id, timestamp };
}
