const rotateLeft = (value, bits) => (value << bits) | (value >>> (32 - bits));

/** Owned SHA-1 digest with the existing symbols byte-array contract; input-sized padding is retained. */
export function sha1(input) {
  const length = input.length;
  const padded = new Uint8Array(Math.ceil((length + 9) / 64) * 64);
  padded.set(input);
  padded[length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, length * 8);
  const hash = Uint32Array.from([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const words = new Uint32Array(80);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 80; index++) {
      words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
    }
    let [a, b, c, d, e] = hash;
    for (let index = 0; index < 80; index++) {
      const mixed = index < 20 ? (b & c) | (~b & d) : index < 40 ? b ^ c ^ d : index < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const constant = index < 20 ? 0x5a827999 : index < 40 ? 0x6ed9eba1 : index < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const next = (rotateLeft(a, 5) + mixed + e + constant + words[index]) | 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }
    [a, b, c, d, e].forEach((value, index) => { hash[index] += value; });
  }
  const result = new Uint8Array(20);
  const digest = new DataView(result.buffer);
  hash.forEach((value, index) => digest.setUint32(index * 4, value));
  return result;
}
