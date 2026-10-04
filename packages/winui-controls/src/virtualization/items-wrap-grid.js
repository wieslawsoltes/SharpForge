/** Uniform layouts compute the realized range arithmetically: no work proportional to total items. */
export class ItemsWrapGrid {
  constructor({ source, itemWidth = 100, itemHeight = 32, minimumColumnSpacing = 0,
    minimumRowSpacing = 0, maximumRowsOrColumns = Infinity, cacheLength = 1, maximumRealized = 4096 } = {}) {
    if (!(itemWidth > 0) || !(itemHeight > 0)) throw new RangeError('Virtual grid item dimensions must be positive');
    Object.assign(this, { source, itemWidth, itemHeight, minimumColumnSpacing, minimumRowSpacing,
      maximumRowsOrColumns, cacheLength, maximumRealized });
  }
  arrange(viewport) {
    const strideX = this.itemWidth + this.minimumColumnSpacing;
    const strideY = this.itemHeight + this.minimumRowSpacing;
    const columns = Math.max(1, Math.min(this.maximumRowsOrColumns,
      Math.floor((viewport.width + this.minimumColumnSpacing) / strideX)));
    const rows = Math.ceil(this.source.count / columns);
    const startRow = Math.max(0, Math.floor((viewport.y - viewport.height * this.cacheLength) / strideY));
    const endRow = Math.min(rows, Math.ceil((viewport.y + viewport.height * (1 + this.cacheLength)) / strideY));
    const start = Math.min(this.source.count, startRow * columns);
    const end = Math.min(this.source.count, endRow * columns);
    if (end - start > this.maximumRealized) throw new RangeError('Virtual grid realization budget exceeded');
    const items = [];
    for (let index = start; index < end; index++) items.push({ index, key: this.source.keyAt(index),
      x: index % columns * strideX, y: Math.floor(index / columns) * strideY, width: this.itemWidth, height: this.itemHeight });
    return { items, columns, extent: { width: Math.max(0, columns * strideX - this.minimumColumnSpacing),
      height: Math.max(0, rows * strideY - this.minimumRowSpacing) } };
  }
}

export class UniformGridLayout extends ItemsWrapGrid {}
