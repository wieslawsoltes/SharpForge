/** Justified lines use a cached row index. Initial indexing is cancellable and yields between bounded chunks. */
export class LinedFlowLayout {
  constructor({ source, lineHeight = 160, minimumItemSpacing = 4, lineSpacing = 4,
    aspectRatioAt = () => 1, maximumRealized = 4096 } = {}) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) throw new RangeError('Line height must be positive');
    Object.assign(this, { source, lineHeight, minimumItemSpacing, lineSpacing, aspectRatioAt, maximumRealized });
    this.rows = [];
    this.width = 0;
    this.indexedCount = 0;
    this.generation = 0;
  }
  async prepare(width, { signal, chunkSize = 2048, yieldWork = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    if (!Number.isFinite(width) || width <= 0) throw new RangeError('LinedFlowLayout requires a positive width');
    const generation = ++this.generation;
    this.rows = [];
    this.width = width;
    this.indexedCount = 0;
    let start = 0;
    let sum = 0;
    let count = 0;
    for (let index = 0; index < this.source.count; index++) {
      signal?.throwIfAborted();
      if (generation !== this.generation) throw new Error('LinedFlowLayout indexing was superseded');
      const aspect = this.aspectRatioAt(index);
      if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Item aspect ratio must be positive');
      if (count && (sum + aspect) * this.lineHeight + count * this.minimumItemSpacing > width) {
        this.rows.push({ start, end: index, sum });
        start = index;
        sum = 0;
        count = 0;
      }
      sum += aspect;
      count++;
      this.indexedCount = index + 1;
      if ((index + 1) % chunkSize === 0) await yieldWork();
    }
    if (count) this.rows.push({ start, end: this.source.count, sum });
    return this;
  }
  arrange(viewport) {
    if (viewport.width !== this.width || this.indexedCount !== this.source.count) {
      throw new Error('LinedFlowLayout requires prepare(viewport.width) after width or source changes');
    }
    const stride = this.lineHeight + this.lineSpacing;
    const first = Math.max(0, Math.floor(viewport.y / stride) - 1);
    const last = Math.min(this.rows.length, Math.ceil((viewport.y + viewport.height) / stride) + 1);
    const items = [];
    for (let rowIndex = first; rowIndex < last; rowIndex++) {
      const row = this.rows[rowIndex];
      const available = Math.max(0, viewport.width - (row.end - row.start - 1) * this.minimumItemSpacing);
      const scale = rowIndex === this.rows.length - 1 ? Math.min(this.lineHeight, available / row.sum) : available / row.sum;
      let x = 0;
      for (let index = row.start; index < row.end; index++) {
        if (items.length >= this.maximumRealized) throw new RangeError('Lined flow realization budget exceeded');
        const width = this.aspectRatioAt(index) * scale;
        items.push({ index, key: this.source.keyAt(index), x, y: rowIndex * stride, width, height: this.lineHeight });
        x += width + this.minimumItemSpacing;
      }
    }
    return { items, extent: { width: viewport.width, height: Math.max(0, this.rows.length * stride - this.lineSpacing) } };
  }
  dispose() { this.generation++; this.rows = []; this.indexedCount = 0; }
}
