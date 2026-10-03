const roundConstants = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotateRight = (value, bits) => (value >>> bits) | (value << (32 - bits));

/** Synchronous SHA-256 with fixed scratch space; accepts up to 128 MiB and returns an owned 32-byte digest. */
export function sha256(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError('SHA-256 input must be Uint8Array');
  if (input.length > 128 * 1024 * 1024) throw new RangeError('SHA-256 input exceeds size limit');
  const length = input.length;
  const completeBytes = length - length % 64;
  const remaining = length - completeBytes;
  const tail = new Uint8Array(remaining < 56 ? 64 : 128);
  tail.set(input.subarray(completeBytes));
  tail[remaining] = 128;
  const tailView = new DataView(tail.buffer);
  tailView.setUint32(tail.length - 8, Math.floor(length / 0x20000000));
  tailView.setUint32(tail.length - 4, length * 8);
  const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const state = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < completeBytes + tail.length; offset += 64) {
    const view = offset < completeBytes ? inputView : tailView;
    const blockOffset = offset < completeBytes ? offset : offset - completeBytes;
    for (let index = 0; index < 16; index++) schedule[index] = view.getUint32(blockOffset + index * 4);
    for (let index = 16; index < 64; index++) {
      const left = schedule[index - 15], right = schedule[index - 2];
      schedule[index] = schedule[index - 16] + (rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3))
        + schedule[index - 7] + (rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10));
    }
    let word0 = state[0];
    let word1 = state[1];
    let word2 = state[2];
    let word3 = state[3];
    let word4 = state[4];
    let word5 = state[5];
    let word6 = state[6];
    let word7 = state[7];
    for (let index = 0; index < 64; index++) {
      const first = (word7 + (rotateRight(word4, 6) ^ rotateRight(word4, 11) ^ rotateRight(word4, 25))
        + ((word4 & word5) ^ (~word4 & word6)) + roundConstants[index] + schedule[index]) | 0;
      const second = ((rotateRight(word0, 2) ^ rotateRight(word0, 13) ^ rotateRight(word0, 22))
        + ((word0 & word1) ^ (word0 & word2) ^ (word1 & word2))) | 0;
      word7 = word6;
      word6 = word5;
      word5 = word4;
      word4 = (word3 + first) | 0;
      word3 = word2;
      word2 = word1;
      word1 = word0;
      word0 = (first + second) | 0;
    }
    state[0] += word0;
    state[1] += word1;
    state[2] += word2;
    state[3] += word3;
    state[4] += word4;
    state[5] += word5;
    state[6] += word6;
    state[7] += word7;
  }
  const digest = new Uint8Array(32), output = new DataView(digest.buffer);
  state.forEach((value, index) => output.setUint32(index * 4, value));
  return digest;
}
