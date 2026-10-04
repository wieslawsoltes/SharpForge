// FIPS 180-4 SHA-384/SHA-512 constants; fractional cube roots of the first 80 primes.
const roundConstants = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];
const initial512 = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];
const initial384 = [
  0xcbbb9d5dc1059ed8n,
  0x629a292a367cd507n,
  0x9159015a3070dd17n,
  0x152fecd8f70e5939n,
  0x67332667ffc00b31n,
  0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n,
  0x47b5481dbefa4fa4n,
];
const mask = (1n << 64n) - 1n;
const rotate = (value, bits) => (value >> bits) | ((value << (64n - bits)) & mask);

function compress(state, words) {
  let [a, b, c, d, e, f, g, h] = state;
  for (let index = 0; index < 80; index++) {
    if (index >= 16) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotate(left, 1n) ^ rotate(left, 8n) ^ (left >> 7n);
      const sigma1 = rotate(right, 19n) ^ rotate(right, 61n) ^ (right >> 6n);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) & mask;
    }
    const sum1 = rotate(e, 14n) ^ rotate(e, 18n) ^ rotate(e, 41n);
    const choice = (e & f) ^ (~e & g);
    const temporary1 = (h + sum1 + choice + roundConstants[index] + words[index]) & mask;
    const sum0 = rotate(a, 28n) ^ rotate(a, 34n) ^ rotate(a, 39n);
    const majority = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = (d + temporary1) & mask;
    d = c;
    c = b;
    b = a;
    a = (temporary1 + sum0 + majority) & mask;
  }
  const result = [a, b, c, d, e, f, g, h];
  for (let index = 0; index < 8; index++) state[index] = (state[index] + result[index]) & mask;
}

/** Synchronous SHA-384/512 for binary format checksums; 128-byte scratch blocks, O(input bytes). */
export function wideHash(bytes, bits = 512) {
  if (!(bytes instanceof Uint8Array) || ![384, 512].includes(bits)) throw new TypeError('Invalid SHA-384/512 input');
  const state = [...(bits === 384 ? initial384 : initial512)];
  const words = new BigUint64Array(80);
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fullBytes = bytes.length - (bytes.length % 128);
  for (let offset = 0; offset < fullBytes; offset += 128) {
    for (let index = 0; index < 16; index++) words[index] = input.getBigUint64(offset + index * 8, false);
    compress(state, words);
  }
  const tail = new Uint8Array(bytes.length - fullBytes < 112 ? 128 : 256);
  tail.set(bytes.subarray(fullBytes));
  tail[bytes.length - fullBytes] = 128;
  const view = new DataView(tail.buffer);
  view.setBigUint64(tail.length - 8, BigInt(bytes.length) * 8n, false);
  for (let offset = 0; offset < tail.length; offset += 128) {
    for (let index = 0; index < 16; index++) words[index] = view.getBigUint64(offset + index * 8, false);
    compress(state, words);
  }
  const result = new Uint8Array(bits / 8);
  const output = new DataView(result.buffer);
  for (let index = 0; index < result.length / 8; index++) output.setBigUint64(index * 8, state[index], false);
  return result;
}
