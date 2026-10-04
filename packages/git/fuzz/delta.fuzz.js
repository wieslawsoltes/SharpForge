import { applyDelta, createDelta } from '../src/pack/delta.js';

export function createDeltaFuzzer() {
  const base = new TextEncoder().encode('0123456789abcdef'.repeat(8));
  const target = new TextEncoder().encode('0123456789abcdef'.repeat(6) + 'changed tail');
  return {
    name: 'delta', corpus: [
      { bytes: createDelta(base, target), valid: true },
      { bytes: Uint8Array.of(128, 1, 0), valid: true },
      { bytes: Uint8Array.of(128, 1, 255, 255, 255, 255, 255, 255, 255, 127, 128), valid: false }
    ],
    parse: bytes => applyDelta(base, bytes, { maxObjectBytes: 4096 })
  };
}
