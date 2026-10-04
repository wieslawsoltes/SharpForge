import { RealizationWindow } from './realization-window.js';

export class ItemsStackPanel {
  constructor({ source, orientation = 'Vertical', spacing = 0, ...options }) {
    this.source = source;
    this.orientation = orientation;
    this.spacing = spacing;
    this.window = new RealizationWindow({ ...options, count: source.count, keyAt: index => source.keyAt(index),
      indexOfKey: key => source.indexOfKey?.(key) });
    this.groupHeaderPlacement = 'Top';
    this.itemsUpdatingScrollMode = 'KeepItemsInView';
  }
  arrange(viewport) {
    const horizontal = this.orientation === 'Horizontal';
    const range = this.window.update(horizontal ? viewport.x : viewport.y, horizontal ? viewport.width : viewport.height);
    const items = [];
    for (let index = range.start; index < range.end; index++) {
      const offset = this.window.sizes.offsetOf(index);
      const length = Math.max(0, this.window.sizes.sizeAt(index) - this.spacing);
      items.push({ index, key: this.source.keyAt(index), x: horizontal ? offset : 0, y: horizontal ? 0 : offset,
        width: horizontal ? length : viewport.width, height: horizontal ? viewport.height : length });
    }
    return { items, extent: horizontal ? { width: range.extent, height: viewport.height }
      : { width: viewport.width, height: range.extent }, anchor: this.window.anchor };
  }
  measure(index, size) { return this.window.measure(index, (this.orientation === 'Horizontal' ? size.width : size.height) + this.spacing); }
  sourceChanged(options = {}) { return this.window.sourceChanged(this.source.count, { mode: this.itemsUpdatingScrollMode, ...options }); }
}

export class VirtualizingStackPanel extends ItemsStackPanel {}
export class StackLayout extends ItemsStackPanel {}
