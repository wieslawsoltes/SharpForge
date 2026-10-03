import { asBytes } from '../hash/bytes.js';

/** RFC 1950 Adler-32; the optional seed permits checksumming successive chunks. */
export function adler32(input, seed = 1) {
  const bytes = asBytes(input);
  let first = seed & 65535;
  let second = seed >>> 16;
  for (let offset = 0; offset < bytes.length;) {
    // 5552 bytes keep both integer sums within uint32, as in the reference zlib algorithm.
    const end = Math.min(offset + 5552, bytes.length);
    while (offset < end) {
      first += bytes[offset++];
      second += first;
    }
    first %= 65521;
    second %= 65521;
  }
  return ((second << 16) | first) >>> 0;
}
