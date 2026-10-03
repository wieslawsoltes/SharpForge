import { fail } from './contracts.js';
export function writeSignedCompressed(w, n) {
  if (!Number.isInteger(n) || n < -0x10000000 || n > 0xfffffff) fail('Signed PDB integer out of range');
  const bits = n >= -64 && n <= 63 ? 7 : n >= -8192 && n <= 8191 ? 14 : 29,
    v = ((n & (2 ** (bits - 1) - 1)) * 2 + (n < 0 ? 1 : 0)) >>> 0;
  if (bits === 7) w.u8(v);
  else if (bits === 14) w.u8((v >>> 8) | 0x80).u8(v);
  else
    w.u8((v >>> 24) | 0xc0)
      .u8(v >>> 16)
      .u8(v >>> 8)
      .u8(v);
  return w;
}
