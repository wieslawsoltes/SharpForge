/** Ordered, bounded announcements with an injectable scheduler for deterministic hosts and tests. */
export class DesignerAnnouncements {
  constructor({announce, schedule = callback => setTimeout(callback, 50), cancel = clearTimeout, limit = 128} = {}) {
    if (typeof announce !== 'function') throw new TypeError('An announcement sink is required');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid announcement queue limit');
    Object.assign(this, {announce, schedule, cancel, limit});
    this.pending = [];
    this.transcript = [];
    this.timer = null;
    this.disposed = false;
    this.previous = null;
  }

  push(message) {
    if (this.disposed || !message || message === this.previous) return false;
    const text = String(message).slice(0, 2048);
    this.previous = text;
    this.pending.push(text);
    if (this.pending.length > this.limit) this.pending.shift();
    if (this.timer === null) this.timer = this.schedule(() => this.flush());
    return true;
  }

  flush() {
    this.timer = null;
    if (this.disposed) return;
    const message = this.pending.shift();
    if (message) {
      this.transcript.push(message);
      if (this.transcript.length > this.limit) this.transcript.shift();
      this.announce(message);
    }
    if (this.pending.length) this.timer = this.schedule(() => this.flush());
  }

  dispose() {
    this.disposed = true;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.pending = [];
  }
}
