export class ManualClock {
  constructor() { this.time = 0; this.next = 1; this.timers = new Map(); }
  schedule = (callback, delay) => {
    const id = this.next++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };
  cancel = id => this.timers.delete(id);
  advance(duration) {
    const until = this.time + duration;
    let ticks = 0;
    while (true) {
      const first = [...this.timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!first) break;
      if (++ticks > 10_000) throw new Error('Manual clock timer loop exceeded its budget');
      this.timers.delete(first[0]);
      this.time = first[1].at;
      first[1].callback();
    }
    this.time = until;
  }
}
