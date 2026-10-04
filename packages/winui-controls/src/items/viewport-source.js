import { ControlEvents, ControlError } from '../policy/events.js';

const maximumRecords = 2048;

/** Sparse scene projection: the managed source owns values outside the realized viewport. */
export class ViewportItemSource {
  constructor(descriptor) { this.update(descriptor); }
  update(descriptor) {
    if (descriptor === this.descriptor) return;
    if (descriptor?.version !== 1 || !Number.isSafeInteger(descriptor.count) || descriptor.count < 0
      || descriptor.count > 1_000_000 || !Array.isArray(descriptor.realized) || descriptor.realized.length > maximumRecords) {
      throw new ControlError('SFUI1603', 'Invalid bounded item-scene descriptor');
    }
    const records = new Map();
    for (const record of descriptor.realized) {
      if (!Number.isInteger(record.index) || record.index < 0 || record.index >= descriptor.count || records.has(record.index)) {
        throw new ControlError('SFUI1603', 'Invalid or duplicate realized item index');
      }
      records.set(record.index, record);
    }
    this.descriptor = descriptor;
    this.count = descriptor.count;
    this.length = descriptor.count;
    this.revision = descriptor.revision;
    this.records = records;
    this.selection = descriptor.selection;
    this.groups = descriptor.groups;
  }
  getAt(index) { return this.records.get(index)?.item; }
  keyAt(index) { return this.records.get(index)?.key ?? `${this.revision}:${index}`; }
  indexOfKey(key) {
    for (const [index, record] of this.records) if (record.key === key || this.keyAt(index) === key) return index;
    const [revision, index] = String(key).split(':');
    return revision === String(this.revision) && Number(index) >= 0 && Number(index) < this.count ? Number(index) : -1;
  }
}

const sceneSources = new WeakMap();

export function viewportSource(node) {
  const descriptor = node.properties.$items;
  if (!descriptor) return null;
  let source = sceneSources.get(node);
  if (!source) { source = new ViewportItemSource(descriptor); sceneSources.set(node, source); }
  else source.update(descriptor);
  return source;
}

/** Compact ranges keep Ctrl+A and very distant shift selection independent of source length. */
export class ViewportSelectionModel extends ControlEvents {
  constructor() {
    super();
    this.source = null;
    this.mode = 1;
    this.ranges = [];
    this.current = -1;
    this.anchor = -1;
  }
  get count() { return this.source?.count ?? 0; }
  get selectedIndex() { return this.current; }
  get selectedItem() { return this.getAt(this.current) ?? null; }
  get selectedItems() {
    return [...this.source?.records ?? []].filter(([index]) => this.isSelected(index)).map(([, record]) => record.item);
  }
  get selectedRanges() { return this.ranges.map(([first, end]) => ({ FirstIndex: first, Length: end - first })); }
  get selectedIndices() {
    return this.ranges.flatMap(([first, end]) => Array.from({ length: end - first }, (_, index) => first + index));
  }
  getAt(index) { return this.source?.getAt(index); }
  keyAt(index) { return this.source?.keyAt(index); }
  indexOfKey(key) { return this.source?.indexOfKey(key) ?? -1; }
  isSelected(index) { return this.ranges.some(([first, end]) => index >= first && index < end); }
  setItems(source) {
    if (!(source instanceof ViewportItemSource)) throw new ControlError('SFUI1603', 'A sparse selection requires a viewport source');
    this.source = source;
    if (source.selection) {
      const { current, ranges } = source.selection;
      if (!Number.isInteger(current) || current < -1 || current >= source.count || !Array.isArray(ranges)
        || ranges.length > source.count) throw new ControlError('SFUI1603', 'Invalid sparse selection state');
      this.ranges = [];
      for (const range of ranges) {
        if (!Number.isInteger(range.FirstIndex) || !Number.isInteger(range.Length) || range.FirstIndex < 0
          || range.Length < 0 || range.FirstIndex + range.Length > source.count) {
          throw new ControlError('SFUI1603', 'Sparse selection range is outside the item source');
        }
        if (range.Length) this.#change(range.FirstIndex, range.FirstIndex + range.Length, true);
      }
      this.current = this.isSelected(current) ? current : this.ranges[0]?.[0] ?? -1;
    } else {
      this.ranges = this.ranges.map(([first, end]) => [first, Math.min(source.count, end)]).filter(([first, end]) => first < end);
      if (this.current >= source.count) this.current = -1;
    }
  }
  setMode(mode) {
    if (![0, 1, 2, 3].includes(mode)) throw new ControlError('SFUI1601', 'Invalid selection mode');
    this.mode = mode;
    if (mode === 0) this.clear();
    else if (mode === 1 && this.current >= 0) this.select(this.current);
  }
  select(index, { toggle = false, range = false, additive = false } = {}) {
    if (index === -1) return this.clear();
    this.#index(index);
    if (!this.mode) return false;
    const before = this.selectedItems;
    if (range && this.mode >= 2) {
      if (!additive) this.ranges = [];
      this.#change(Math.min(this.anchor < 0 ? index : this.anchor, index), Math.max(this.anchor, index) + 1, true);
    } else if (toggle || this.mode === 2) {
      this.#change(index, index + 1, !this.isSelected(index));
      this.anchor = index;
    } else {
      if (!additive || this.mode === 1) this.ranges = [];
      this.#change(index, index + 1, true);
      this.anchor = index;
    }
    this.current = this.isSelected(index) ? index : this.ranges[0]?.[0] ?? -1;
    this.#changed(before);
    return true;
  }
  selectRange(first, length, selected = true) {
    if (!Number.isInteger(length) || length < 0 || first + length > this.count) throw new ControlError('SFUI1601', 'Invalid selection range');
    if (!length || !this.mode) return;
    this.#index(first);
    if (this.mode === 1 && selected) return this.select(first);
    const before = this.selectedItems;
    this.#change(first, first + length, selected);
    this.current = selected ? first : this.isSelected(this.current) ? this.current : this.ranges[0]?.[0] ?? -1;
    this.#changed(before);
  }
  selectAll() { if (this.mode >= 2) this.selectRange(0, this.count); }
  clear() {
    const before = this.selectedItems;
    this.ranges = [];
    this.current = this.anchor = -1;
    this.#changed(before);
  }
  value(path = '') {
    let value = this.selectedItem;
    for (const part of path ? path.split('.') : []) value = value?.[part];
    return value;
  }
  #index(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) throw new ControlError('SFUI1601', 'Item index is outside source bounds');
  }
  #change(first, end, selected) {
    if (!selected) {
      this.ranges = this.ranges.flatMap(([low, high]) => high <= first || low >= end ? [[low, high]]
        : [...(low < first ? [[low, first]] : []), ...(high > end ? [[end, high]] : [])]);
      return;
    }
    const ranges = [...this.ranges, [first, end]].sort((a, b) => a[0] - b[0]);
    this.ranges = [];
    for (const [low, high] of ranges) {
      const previous = this.ranges.at(-1);
      if (previous && previous[1] >= low) previous[1] = Math.max(previous[1], high);
      else this.ranges.push([low, high]);
    }
  }
  #changed(before) {
    const current = this.selectedItems;
    this.emit('selectionChanged', { AddedItems: current.filter(value => !before.includes(value)),
      RemovedItems: before.filter(value => !current.includes(value)), SelectedIndex: this.current,
      SelectedRanges: this.selectedRanges });
  }
}
