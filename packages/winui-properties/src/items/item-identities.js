import {ResourceFault} from '../resources/errors.js';

/** Persistent arithmetic runs preserve occurrence identities without allocating one key per source item. */
export class ItemIdentities {
  constructor({maxRuns = 100000} = {}) {
    this.maxRuns = maxRuns;
    this.runs = Object.freeze([]);
    this.ends = Object.freeze([]);
    this.next = 1;
  }

  keyAt(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= (this.ends.at(-1) ?? 0)) return null;
    let low = 0, high = this.ends.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (index < this.ends[middle]) high = middle;
      else low = middle + 1;
    }
    return this.runs[low].key + index - (this.ends[low - 1] ?? 0);
  }

  reset(count) {
    this.commit(count ? [{key: this.next, count}] : []);
    this.next += count;
  }

  replace(index, count, added) {
    const size = this.ends.at(-1) ?? 0;
    const runs = this.slice(0, index);
    if (added) runs.push({key: this.next, count: added});
    this.commit(runs.concat(this.slice(index + count, size)));
    this.next += added;
  }

  move(from, to) {
    if (from === to) return;
    const size = this.ends.at(-1) ?? 0, selected = this.slice(from, from + 1);
    const runs = from < to ? this.slice(0, from).concat(this.slice(from + 1, to + 1), selected, this.slice(to + 1, size))
      : this.slice(0, to).concat(selected, this.slice(to, from), this.slice(from + 1, size));
    this.commit(runs);
  }

  slice(start, end) {
    const runs = [];
    let offset = 0;
    for (const run of this.runs) {
      const first = Math.max(start, offset), last = Math.min(end, offset + run.count);
      if (first < last) runs.push({key: run.key + first - offset, count: last - first});
      offset += run.count;
      if (offset >= end) break;
    }
    return runs;
  }

  commit(input) {
    const runs = [], ends = [];
    let count = 0;
    for (const value of input) {
      if (!value.count) continue;
      const previous = runs.at(-1);
      if (previous && previous.key + previous.count === value.key) previous.count += value.count;
      else runs.push({...value});
    }
    if (runs.length > this.maxRuns || !Number.isSafeInteger(this.next + input.reduce((sum, run) => sum + run.count, 0))) {
      throw new ResourceFault('SFITEM014', 'Item occurrence identity budget exceeded.');
    }
    for (const run of runs) { count += run.count; ends.push(count); Object.freeze(run); }
    this.runs = Object.freeze(runs);
    this.ends = Object.freeze(ends);
  }

  snapshot() { return {runs: this.runs, ends: this.ends, next: this.next}; }
  restore(snapshot) { this.runs = snapshot.runs; this.ends = snapshot.ends; this.next = snapshot.next; }
}
