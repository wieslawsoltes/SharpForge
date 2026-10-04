// RFC 1321 constants. MD5 is retained only for the legacy ECMA AssemblyHashAlgorithm contract.
const shifts = Object.freeze([7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]);
const constants = Object.freeze([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

/** Fixed-scratch compatibility digest. The caller owns the input and enforces the linked-file byte limit. */
export function fileMd5(bytes) {
  const words = new Uint32Array(16);
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes.length;
  const paddedLength = Math.ceil((length + 9) / 64) * 64;
  const bitLength = BigInt(length) * 8n;
  const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let word = 0; word < 16; word++) {
      const position = offset + word * 4;
      if (position + 4 <= length) words[word] = input.getUint32(position, true);
      else {
        let value = 0;
        for (let part = 0; part < 4; part++) {
          const at = position + part;
          const byte = at < length ? bytes[at] : at === length ? 0x80
            : at >= paddedLength - 8 ? Number((bitLength >> BigInt((at - paddedLength + 8) * 8)) & 255n) : 0;
          value |= byte << (part * 8);
        }
        words[word] = value;
      }
    }
    let first = state[0];
    let second = state[1];
    let third = state[2];
    let fourth = state[3];
    for (let step = 0; step < 64; step++) {
      let mixed;
      let word;
      if (step < 16) {
        mixed = (second & third) | (~second & fourth);
        word = step;
      } else if (step < 32) {
        mixed = (fourth & second) | (~fourth & third);
        word = (5 * step + 1) & 15;
      } else if (step < 48) {
        mixed = second ^ third ^ fourth;
        word = (3 * step + 5) & 15;
      } else {
        mixed = third ^ (second | ~fourth);
        word = (7 * step) & 15;
      }
      const shift = shifts[(step >>> 4) * 4 + (step & 3)];
      const sum = (first + mixed + constants[step] + words[word]) | 0;
      const next = (second + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      first = fourth;
      fourth = third;
      third = second;
      second = next;
    }
    state[0] += first;
    state[1] += second;
    state[2] += third;
    state[3] += fourth;
  }
  const result = new Uint8Array(16);
  const output = new DataView(result.buffer);
  for (let index = 0; index < 4; index++) output.setUint32(index * 4, state[index], true);
  return result;
}
