/** Bounded navigation locations retain document group, view and popout identity without editor references. */
export class WorkbenchNavigationHistory {
  constructor({ limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new RangeError('Invalid navigation history limit');
    this.limit = limit;
    this.clear();
  }

  clear() { this.entries = []; this.index = -1; }
  get current() { return this.entries[this.index] ?? null; }
  get canBack() { return this.index > 0; }
  get canForward() { return this.index >= 0 && this.index < this.entries.length - 1; }

  location(value) {
    const { uri, start, end = start, groupId = null, windowId = 'main', viewId = 'primary' } = value ?? {};
    if (typeof uri !== 'string' || !uri || uri.length > 8192 || !Number.isSafeInteger(start) || start < 0
        || !Number.isSafeInteger(end) || end < start || groupId !== null && (typeof groupId !== 'string' || groupId.length > 1024)
        || typeof windowId !== 'string' || windowId.length > 2048 || typeof viewId !== 'string' || viewId.length > 1024) {
      throw new TypeError('Invalid workbench navigation location');
    }
    return Object.freeze({ uri, start, end, groupId, windowId, viewId,
      scrollTop: Math.max(0, Number(value.scrollTop) || 0), scrollLeft: Math.max(0, Number(value.scrollLeft) || 0) });
  }

  update(value) {
    const entry = this.location(value);
    if (this.index < 0) return this.push(entry);
    this.entries[this.index] = entry;
    return entry;
  }

  push(value) {
    const entry = this.location(value);
    const current = this.current;
    if (current && ['uri', 'start', 'end', 'groupId', 'windowId', 'viewId'].every(key => current[key] === entry[key])) return current;
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit) this.entries.shift();
    this.index = this.entries.length - 1;
    return entry;
  }

  back(current) { if (current) this.update(current); return this.canBack ? this.entries[--this.index] : null; }
  forward(current) { if (current) this.update(current); return this.canForward ? this.entries[++this.index] : null; }
  go(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.entries.length) throw new RangeError('Invalid history entry');
    this.index = index;
    return this.current;
  }
  snapshot() { return { entries: [...this.entries], index: this.index, canBack: this.canBack, canForward: this.canForward }; }
}
