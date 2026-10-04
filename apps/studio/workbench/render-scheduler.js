/** Dirty hidden panels retain state without scheduling DOM writes. */
export class ToolRenderScheduler {
  constructor({schedule = callback => requestAnimationFrame(callback), cancel = token => cancelAnimationFrame(token)} = {}) {
    this.schedule = schedule;
    this.cancelFrame = cancel;
    this.entries = new Map();
    this.pending = null;
    this.disposed = false;
  }
  register(id, {render, visible = () => true}) {
    if (this.disposed) throw new Error('Tool scheduler disposed');
    if (this.entries.has(id)) throw new Error('Duplicate tool scheduler entry ' + id);
    this.entries.set(id, {render, visible, dirty: true});
    return () => this.entries.delete(id);
  }
  invalidate(id) {
    if (this.disposed) return;
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.dirty = true;
    if (entry.visible() && this.pending === null) this.pending = this.schedule(() => this.flush());
  }
  flush() {
    this.pending = null;
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (!entry.dirty || !entry.visible()) continue;
      entry.dirty = false;
      entry.render();
    }
  }
  activate(id) { this.invalidate(id); }
  dispose() {
    this.disposed = true;
    if (this.pending !== null) this.cancelFrame(this.pending);
    this.entries.clear();
  }
}
