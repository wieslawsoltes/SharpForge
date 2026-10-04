/** Explicit user text scale is separate from rasterization scale and affects measure only. */
export class TextScalePolicy {
  constructor({ factor = 1, onChanged = () => {} } = {}) {
    this.factor = 1;
    this.onChanged = onChanged;
    this.listeners = new Set();
    this.setFactor(factor);
  }
  setFactor(factor) {
    if (!Number.isFinite(factor) || factor < 0.5 || factor > 8) throw new RangeError('Text scale must be between 0.5 and 8');
    if (this.factor === factor) return;
    this.factor = factor;
    this.onChanged(factor);
    for (const callback of [...this.listeners]) callback(factor);
  }
  subscribe(callback) {
    if (typeof callback !== 'function') throw new TypeError('Text scale subscription requires a callback');
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  fontSize(size, enabled = true) { return enabled ? size * this.factor : size; }
}
