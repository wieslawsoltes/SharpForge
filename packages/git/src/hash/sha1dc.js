import { GitError } from '../errors.js';
import { disturbanceVectors } from './sha1dc-vectors.js';
import { unavoidableBitConditions } from './sha1dc-ubc.js';

// Counter-cryptanalysis port of MIT sha1collisiondetection (Stevens/Shumow).
// The logical state representation differs from upstream's unrolled register rotation;
// recompression reverses the same SHA-1 steps and compares the complete final chaining value.
const constants = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

function rotateLeft(value, bits) {
  return (value << bits) | (value >>> (32 - bits));
}

function roundFunction(step, b, c, d) {
  if (step < 20) return (b & c) | (~b & d);
  if (step < 40 || step >= 60) return b ^ c ^ d;
  return (b & c) | (b & d) | (c & d);
}

function expand(words) {
  for (let index = 16; index < 80; index++) {
    words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
  }
}

function forward(state, words, start) {
  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  for (let step = start; step < 80; step++) {
    const next = (rotateLeft(a, 5) + roundFunction(step, b, c, d) + e + constants[step / 20 | 0] + words[step]) >>> 0;
    e = d;
    d = c;
    c = rotateLeft(b, 30);
    b = a;
    a = next;
  }
  state[0] = a;
  state[1] = b;
  state[2] = c;
  state[3] = d;
  state[4] = e;
}

function backward(state, words, start) {
  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  for (let step = start - 1; step >= 0; step--) {
    const previousB = rotateLeft(c, 2);
    const previousE = (a - rotateLeft(b, 5) - roundFunction(step, previousB, d, e)
      - constants[step / 20 | 0] - words[step]) >>> 0;
    a = b;
    b = previousB;
    c = d;
    d = e;
    e = previousE;
  }
  state[0] = a;
  state[1] = b;
  state[2] = c;
  state[3] = d;
  state[4] = e;
}

/** SHA-1 block engine with all 32 SHA1DC disturbance vectors and verified recompression. */
export class Sha1CollisionDetecting {
  constructor() {
    this.state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
    this.words = new Uint32Array(80);
    this.state58 = new Uint32Array(5);
    this.state65 = new Uint32Array(5);
    this.otherWords = new Uint32Array(80);
    this.otherInput = new Uint32Array(5);
    this.otherOutput = new Uint32Array(5);
    this.vectorSchedules = new Array(32);
    this.collisionDetected = false;
  }

  processBlock(bytes, offset) {
    const words = this.words;
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      words[index] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    }
    expand(words);
    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    let e = this.state[4];
    for (let step = 0; step < 80; step++) {
      if (step === 58 || step === 65) {
        const saved = step === 58 ? this.state58 : this.state65;
        saved[0] = a;
        saved[1] = b;
        saved[2] = c;
        saved[3] = d;
        saved[4] = e;
      }
      const next = (rotateLeft(a, 5) + roundFunction(step, b, c, d) + e + constants[step / 20 | 0] + words[step]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }
    this.state[0] += a;
    this.state[1] += b;
    this.state[2] += c;
    this.state[3] += d;
    this.state[4] += e;
    this.checkCollision(unavoidableBitConditions(words));
  }

  checkCollision(mask) {
    if (!mask) return;
    for (let index = 0; index < disturbanceVectors.length; index++) {
      const vector = disturbanceVectors[index];
      if (!(mask & (1 << vector.bit))) continue;
      let difference = this.vectorSchedules[index];
      if (!difference) {
        difference = new Uint32Array(80);
        difference.set(vector.words);
        expand(difference);
        this.vectorSchedules[index] = difference;
      }
      for (let word = 0; word < 80; word++) this.otherWords[word] = this.words[word] ^ difference[word];
      const middle = vector.step === 58 ? this.state58 : this.state65;
      this.otherInput.set(middle);
      this.otherOutput.set(middle);
      backward(this.otherInput, this.otherWords, vector.step);
      forward(this.otherOutput, this.otherWords, vector.step);
      let mismatch = 0;
      for (let word = 0; word < 5; word++) {
        mismatch |= ((this.otherInput[word] + this.otherOutput[word]) >>> 0) ^ this.state[word];
      }
      if (!mismatch) {
        this.collisionDetected = true;
        throw new GitError('Unsafe', 'SHA-1 collision attack detected', { algorithm: 'sha1', collision: true });
      }
    }
  }
}
