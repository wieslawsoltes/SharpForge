import { HARD_LIMITS, validateInput, validateUint32 } from './budgets.js';

/** Reproducible uint32 LCG for fixture variation; not a cryptographic random generator. */
export function createPrng(seed) {
  let state = validateUint32(seed);
  return maximum => {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 0x100000000) {
      throw new RangeError('Random range must be 1..2^32');
    }
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
}

/** Apply one bounded data mutation; source bytes are never changed or interpreted as code. */
export function mutateBytes(source, { seed = 1, caseIndex = 0, maxInputBytes = HARD_LIMITS.maxInputBytes } = {}) {
  validateUint32(seed);
  validateUint32(caseIndex, 'caseIndex');
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > HARD_LIMITS.maxInputBytes) {
    throw new RangeError('Invalid mutation byte limit');
  }
  validateInput(source, maxInputBytes);
  const random = createPrng((seed ^ Math.imul(caseIndex + 1, 0x9e3779b9)) >>> 0);
  const operation = ['replace', 'truncate', 'delete', 'insert', 'duplicate'][caseIndex % 5];
  if (operation === 'truncate') return { input: source.slice(0, random(source.length + 1)), operation };
  if (operation === 'delete' && source.length) {
    const offset = random(source.length);
    const count = 1 + random(Math.min(16, source.length - offset));
    const input = new Uint8Array(source.length - count);
    input.set(source.subarray(0, offset));
    input.set(source.subarray(offset + count), offset);
    return { input, operation };
  }
  if ((operation === 'insert' || operation === 'duplicate') && source.length < maxInputBytes) {
    const count = 1 + random(Math.min(16, maxInputBytes - source.length));
    const offset = random(source.length + 1);
    const input = new Uint8Array(source.length + count);
    input.set(source.subarray(0, offset));
    for (let index = 0; index < count; index++) {
      input[offset + index] = operation === 'duplicate' && source.length ? source[random(source.length)] : random(256);
    }
    input.set(source.subarray(offset), offset + count);
    return { input, operation };
  }
  const input = source.length ? source.slice() : Uint8Array.of(random(256));
  input[random(input.length)] ^= 1 << random(8);
  return { input, operation: 'replace' };
}
