import { ItemSizeIndex } from './size-index.js';

/** Only visible items plus a bounded cache are realized, regardless of source size. */
export class RealizationWindow {
  constructor({ count = 0, estimatedSize = 32, cacheLength = 1, maximumRealized = 4096,
    keyAt = index => index, indexOfKey } = {}) {
    this.sizes = new ItemSizeIndex(count, estimatedSize);
    this.keyAt = keyAt;
    this.indexOfKey = indexOfKey;
    this.cacheLength = cacheLength;
    this.maximumRealized = maximumRealized;
    this.offset = 0;
    this.viewport = 0;
    this.anchor = null;
    this.range = { start: 0, end: 0, offset: 0, extent: this.sizes.extent };
  }
  update(offset, viewport) {
    if (![offset, viewport].every(Number.isFinite) || viewport < 0) throw new RangeError('Invalid realization viewport');
    this.offset = Math.max(0, Math.min(offset, Math.max(0, this.sizes.extent - viewport)));
    this.viewport = viewport;
    if (!this.sizes.count || viewport === 0) return this.range = { start: 0, end: 0, offset: 0, extent: this.sizes.extent };
    const start = this.sizes.indexAt(Math.max(0, this.offset - viewport * this.cacheLength));
    const end = Math.min(this.sizes.count, this.sizes.indexAt(this.offset + viewport * (1 + this.cacheLength)) + 1);
    if (end - start > this.maximumRealized) throw new RangeError('Realization budget exceeded');
    const anchorIndex = this.sizes.indexAt(this.offset);
    this.anchor = { key: this.keyAt(anchorIndex), index: anchorIndex, displacement: this.offset - this.sizes.offsetOf(anchorIndex) };
    return this.range = { start, end, offset: this.sizes.offsetOf(start), extent: this.sizes.extent };
  }
  measure(index, length) {
    const change = this.sizes.setSize(index, length);
    if (this.anchor && index < this.anchor.index) this.offset += change;
    return this.update(this.offset, this.viewport);
  }
  sourceChanged(count, { anchorIndex, mode = 'KeepItemsInView' } = {}) {
    const previous = this.anchor;
    const wasAtEnd = this.offset + this.viewport >= this.sizes.extent - 1;
    this.sizes.resize(count);
    if (mode === 'KeepLastItemInView' && wasAtEnd) this.offset = Math.max(0, this.sizes.extent - this.viewport);
    else if (mode !== 'KeepScrollOffset' && previous) {
      const index = anchorIndex ?? this.indexOfKey?.(previous.key) ?? Math.min(previous.index, count - 1);
      if (index >= 0 && index < count) this.offset = this.sizes.offsetOf(index) + previous.displacement;
    }
    return this.update(this.offset, this.viewport);
  }
  bringIntoView(index, alignment = 'Nearest') {
    const start = this.sizes.offsetOf(index);
    const end = start + this.sizes.sizeAt(index);
    let offset = this.offset;
    if (alignment === 'Start' || start < offset) offset = start;
    else if (alignment === 'End' || end > offset + this.viewport) offset = end - this.viewport;
    else if (alignment === 'Center') offset = start + (end - start - this.viewport) / 2;
    return this.update(offset, this.viewport);
  }
}
