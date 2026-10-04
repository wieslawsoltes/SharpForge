/** Invalid or unsupported regex syntax with a precise UTF-16 position in the pattern. */
export class SearchPatternError extends SyntaxError {
  constructor(message, position, code = 'SEARCH_INVALID_PATTERN') {
    super(`${message} at position ${position}`);
    this.name = 'SearchPatternError';
    this.code = code;
    this.position = position;
  }
}

/** A hard execution bound was reached inside the interpreter, before more pattern work could run. */
export class SearchLimitError extends Error {
  constructor(reason, steps) {
    super(`Search ${reason} limit exceeded`);
    this.name = 'SearchLimitError';
    this.code = 'SEARCH_LIMIT';
    this.reason = reason;
    this.steps = steps;
  }
}

export class SearchBudget {
  constructor({ maxSteps = 2000000, timeLimitMs = 25, maxStack = 20000, signal, clock = () => performance.now() } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 1000000000) throw new RangeError('Invalid search step limit');
    if (!Number.isFinite(timeLimitMs) || timeLimitMs <= 0 || timeLimitMs > 30000) throw new RangeError('Invalid search time limit');
    if (!Number.isSafeInteger(maxStack) || maxStack < 1 || maxStack > 100000) throw new RangeError('Invalid search stack limit');
    this.maxSteps = maxSteps;
    this.maxStack = maxStack;
    this.signal = signal;
    this.clock = clock;
    this.deadline = clock() + timeLimitMs;
    this.steps = 0;
    this.check();
  }
  check() {
    if (this.signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (this.clock() >= this.deadline) throw new SearchLimitError('time', this.steps);
  }
  tick(amount = 1) {
    const previous = this.steps;
    this.steps += amount;
    if (this.steps > this.maxSteps) throw new SearchLimitError('step', this.steps);
    if ((previous >>> 8) !== (this.steps >>> 8)) this.check();
  }
}
