/** Host-owned monotonic millisecond clock. Failures are reported outside managed dispatch. */
class ProfilerClock {
  constructor(clock = () => performance.now()) {
    this.clock = clock;
    this.previous = 0;
    this.totalMilliseconds = 0;
    this.intervals = 0;
    this.failed = false;
    this.failure = null;
  }

  read() {
    if (this.failed) return null;
    try {
      const value = this.clock();
      if (!Number.isFinite(value) || value < this.previous) {
        throw new RangeError('profile.clock must return finite nonnegative monotonic milliseconds');
      }
      this.previous = value;
      return value;
    } catch (error) {
      this.failed = true;
      this.failure = error;
      return null;
    }
  }

  record(milliseconds) {
    if (this.failed) return false;
    const total = this.totalMilliseconds + milliseconds;
    if (!Number.isFinite(total) || !Number.isFinite(milliseconds) || milliseconds < 0) {
      this.failed = true;
      this.failure = new RangeError('Profiler duration total overflow');
      return false;
    }
    this.totalMilliseconds = total;
    this.intervals++;
    return true;
  }

  fail(error) {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
  }

  reportFailure() {
    if (this.failed) throw this.failure;
  }
}

export function createProfilerClock(options) {
  if (options.duration !== undefined && typeof options.duration !== 'boolean') {
    throw new TypeError('profile.duration must be a boolean');
  }
  if (options.clock !== undefined && typeof options.clock !== 'function') {
    throw new TypeError('profile.clock must be a monotonic millisecond function');
  }
  return options.duration === true ? new ProfilerClock(options.clock) : null;
}
