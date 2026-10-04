export const LargeObjectThreshold = 85_000;

/** LOH policy: whole object bytes include headers; only generation 2 reclaims LOH. */
export class LargeObjectHeap {
  constructor({largeObjectThreshold = LargeObjectThreshold} = {}) {
    if (!Number.isSafeInteger(largeObjectThreshold) || largeObjectThreshold < 1) {
      throw new RangeError('Large-object threshold must be a positive safe integer');
    }
    this.threshold = largeObjectThreshold;
  }

  containsSize(bytes) {
    return bytes >= this.threshold;
  }

  shouldCollect(generation) {
    return generation === 2;
  }

  snapshot() {
    return {threshold: this.threshold};
  }
}
