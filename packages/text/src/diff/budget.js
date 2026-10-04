export class DiffLimit extends Error {
  constructor(reason) { super(`Diff ${reason} limit exceeded`); this.reason = reason; }
}

/** One explicit budget is shared by tokenization, path search and character refinement. */
export class DiffBudget {
  constructor({ maxSteps = 2000000, timeLimitMs = 25, maxTraceCells = 2000000, signal, clock = () => performance.now() } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw new RangeError('Invalid diff step limit');
    if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0) throw new RangeError('Invalid diff time limit');
    if (!Number.isSafeInteger(maxTraceCells) || maxTraceCells < 1) throw new RangeError('Invalid diff trace limit');
    this.steps = 0;
    this.maximum = maxSteps;
    this.traceMaximum = maxTraceCells;
    this.signal = signal;
    this.clock = clock;
    this.deadline = clock() + timeLimitMs;
    this.check();
  }
  check() {
    if (this.signal?.aborted) throw new DOMException('Diff cancelled', 'AbortError');
    if (this.clock() >= this.deadline) throw new DiffLimit('time');
  }
  tick() {
    if (++this.steps > this.maximum) throw new DiffLimit('step');
    if (this.steps % 256 === 0) this.check();
  }
}
