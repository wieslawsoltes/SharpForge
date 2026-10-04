/** Sparse measurements over a dense estimated extent; updates and offset lookup are O(log n). */
export class ItemSizeIndex {
  constructor(count, estimate = 32) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10000000) throw new RangeError('Item count must be between zero and ten million');
    if (!Number.isFinite(estimate) || estimate <= 0) throw new RangeError('Estimated item size must be positive');
    this.count = count;
    this.estimate = estimate;
    this.tree = new Float64Array(count + 1);
    this.measured = new Map();
  }
  sizeAt(index) { return this.measured.get(index) ?? this.estimate; }
  setSize(index, value) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new RangeError('Item index is outside the source');
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Realized item size must be positive');
    const change = value - this.sizeAt(index);
    this.measured.set(index, value);
    for (let position = index + 1; position <= this.count; position += position & -position) this.tree[position] += change;
    return change;
  }
  offsetOf(index) {
    if (!Number.isInteger(index) || index < 0 || index > this.count) throw new RangeError('Item boundary is outside the source');
    let offset = index * this.estimate;
    for (let position = index; position > 0; position -= position & -position) offset += this.tree[position];
    return offset;
  }
  indexAt(offset) {
    if (!Number.isFinite(offset)) throw new TypeError('Item offset must be finite');
    if (!this.count || offset <= 0) return 0;
    let index = 0;
    let accumulated = 0;
    let bit = 1;
    while (bit * 2 <= this.count) bit *= 2;
    for (; bit > 0; bit = Math.floor(bit / 2)) {
      const next = index + bit;
      if (next <= this.count) {
        const length = (next & -next) * this.estimate + this.tree[next];
        if (accumulated + length <= offset) { index = next; accumulated += length; }
      }
    }
    return Math.min(this.count - 1, index);
  }
  get extent() { return this.offsetOf(this.count); }
  resize(count) {
    const replacement = new ItemSizeIndex(count, this.estimate);
    for (const [index, value] of this.measured) if (index < count) replacement.setSize(index, value);
    this.count = replacement.count;
    this.tree = replacement.tree;
    this.measured = replacement.measured;
  }
}
