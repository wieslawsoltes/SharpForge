/** Host-owned monotonic millisecond clock; neither its callback nor observations are snapshotted. */
export class ProfilerClock {
  constructor(clock = () => performance.now()) {
    if (typeof clock !== 'function') throw new TypeError('profile.clock must be a monotonic millisecond function');
    this.clock = clock;
    this.previous = 0;
    this.totalMilliseconds = 0;
    this.intervals = 0;
  }

  read() {
    const value = this.clock();
    if (!Number.isFinite(value) || value < this.previous) {
      throw new RangeError('profile.clock must return finite nonnegative monotonic milliseconds');
    }
    this.previous = value;
    return value;
  }

  record(milliseconds) {
    const total = this.totalMilliseconds + milliseconds;
    if (!Number.isFinite(total)) throw new RangeError('Profiler duration total overflow');
    this.totalMilliseconds = total;
    this.intervals++;
  }
}

export function createProfilerClock(options) {
  if (options.duration !== undefined && typeof options.duration !== 'boolean') {
    throw new TypeError('profile.duration must be a boolean');
  }
  if (options.clock !== undefined && typeof options.clock !== 'function') {
    throw new TypeError('profile.clock must be a monotonic millisecond function');
  }
  return options.duration === false ? null : new ProfilerClock(options.clock);
}
