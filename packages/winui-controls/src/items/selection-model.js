import { ControlEvents, ControlError, requireInteger } from '../policy/events.js';

export const SelectionMode = Object.freeze({ None: 0, Single: 1, Multiple: 2, Extended: 3 });

/** O(n) reconciliation, O(1) membership; duplicate items retain occurrence identities. */
export class SelectionModel extends ControlEvents {
  #entries = [];
  #selected = new Set();
  #indices = new Map();
  #anchor = null;
  #current = null;
  #nextIdentity = 1;
  #publishedSelection = new Map();

  constructor({ items = [], mode = SelectionMode.Single, key = item => item?.$ref ?? item } = {}) {
    super();
    this.key = key;
    if (!Object.values(SelectionMode).includes(mode)) throw new ControlError('SFUI1602', 'Unknown selection mode');
    this.mode = mode;
    this.setItems(items);
  }

  get count() { return this.#entries.length; }
  get items() { return this.#entries.map(entry => entry.item); }
  getAt(index) { return this.#entries[index]?.item; }
  keyAt(index) { return this.#entries[index]?.id; }
  indexOfKey(key) { return this.#indices.get(key) ?? -1; }
  get selectedIndices() { return [...this.#selected].map(id => this.#indices.get(id)).sort((a, b) => a - b); }
  get selectedItems() { return this.selectedIndices.map(index => this.#entries[index].item); }
  get selectedIndex() {
    const id = this.#selected.has(this.#current) ? this.#current : this.#selected.values().next().value;
    return this.#indices.get(id) ?? -1;
  }
  get currentIndex() { return this.#indices.get(this.#current) ?? -1; }
  get selectedItem() { return this.#entries[this.selectedIndex]?.item ?? null; }
  *retainedValues() { for (const entry of this.#entries) yield entry.item; }
  get selectedRanges() {
    const ranges = [];
    for (const index of this.selectedIndices) {
      const previous = ranges.at(-1);
      if (previous && previous.FirstIndex + previous.Length === index) previous.Length++;
      else ranges.push({ FirstIndex: index, Length: 1 });
    }
    return ranges;
  }

  setMode(mode) {
    if (!Object.values(SelectionMode).includes(mode)) throw new ControlError('SFUI1602', 'Unknown selection mode');
    this.mode = mode;
    if (mode === SelectionMode.None) this.clear();
    else if (mode === SelectionMode.Single && this.#selected.size > 1) this.select(this.selectedIndex);
  }

  setItems(items) {
    if (!Array.isArray(items) || items.length > 1_000_000) throw new ControlError('SFUI1603', 'Invalid items collection');
    const buckets = new Map();
    for (const entry of this.#entries) {
      let bucket = buckets.get(entry.key);
      if (!bucket) buckets.set(entry.key, bucket = { entries: [], next: 0 });
      bucket.entries.push(entry);
    }
    this.#entries = items.map(item => {
      const key = this.key(item);
      const bucket = buckets.get(key);
      const entry = bucket?.entries[bucket.next++];
      return entry ? { ...entry, item } : { id: this.#nextIdentity++, key, item };
    });
    this.#indices = new Map(this.#entries.map((entry, index) => [entry.id, index]));
    this.#selected = new Set([...this.#selected].filter(id => this.#indices.has(id)));
    if (!this.#indices.has(this.#anchor)) this.#anchor = null;
    if (!this.#indices.has(this.#current)) this.#current = this.#selected.values().next().value ?? null;
    this.#changed('items');
  }

  isSelected(index) { return this.#selected.has(this.#entries[index]?.id); }

  select(index, { toggle = false, range = false, additive = false } = {}) {
    requireInteger(index, 'Selection index', { minimum: -1, maximum: this.count - 1 });
    if (index < 0 || this.mode === SelectionMode.None) return this.clear();
    const entry = this.#entries[index];
    if (this.mode === SelectionMode.Single) {
      this.#selected = new Set([entry.id]);
    } else if (range && this.mode === SelectionMode.Extended) {
      const anchor = this.#indices.get(this.#anchor) ?? index;
      if (!additive) this.#selected.clear();
      for (let current = Math.min(anchor, index); current <= Math.max(anchor, index); current++) {
        this.#selected.add(this.#entries[current].id);
      }
    } else if (toggle || this.mode === SelectionMode.Multiple) {
      if (this.#selected.has(entry.id)) this.#selected.delete(entry.id);
      else this.#selected.add(entry.id);
    } else {
      if (!additive) this.#selected.clear();
      this.#selected.add(entry.id);
    }
    if (!range) this.#anchor = entry.id;
    this.#current = entry.id;
    this.#changed('selection');
  }

  selectRange(first, length, selected = true) {
    requireInteger(first, 'Range start', { maximum: this.count });
    requireInteger(length, 'Range length', { maximum: this.count - first });
    if (this.mode === SelectionMode.None || !length) return;
    if (this.mode === SelectionMode.Single && length > 1) throw new ControlError('SFUI1604', 'Single selection cannot select a range');
    if (this.mode === SelectionMode.Single && selected) this.#selected.clear();
    for (let index = first; index < first + length; index++) {
      const id = this.#entries[index].id;
      if (selected) this.#selected.add(id);
      else this.#selected.delete(id);
    }
    this.#current = selected ? this.#entries[first].id : this.#selected.values().next().value ?? null;
    this.#changed('range');
  }

  selectAll() {
    if (this.mode === SelectionMode.None) return;
    this.selectRange(0, this.mode === SelectionMode.Single ? Math.min(1, this.count) : this.count);
  }

  /** Replace selection in O(k), without replaying k separate selection transactions. */
  setSelectedIndices(indices, currentIndex = indices[0] ?? -1) {
    if (!Array.isArray(indices) || indices.length > this.count) throw new ControlError('SFUI1604', 'Invalid selection index collection');
    if (this.mode === SelectionMode.Single && indices.length > 1) throw new ControlError('SFUI1604', 'Single selection cannot select a range');
    const selected = new Set();
    for (const index of indices) {
      requireInteger(index, 'Selection index', { maximum: this.count - 1 });
      if (this.mode !== SelectionMode.None) selected.add(this.#entries[index].id);
    }
    requireInteger(currentIndex, 'Current item index', { minimum: -1, maximum: this.count - 1 });
    this.#selected = selected;
    this.#current = this.#entries[currentIndex]?.id ?? null;
    this.#anchor = this.#current;
    this.#changed('input');
  }

  clear() {
    this.#selected.clear();
    this.#current = this.#anchor = null;
    this.#changed('clear');
  }

  value(path = '') {
    let value = this.selectedItem;
    for (const part of path ? path.split('.') : []) value = value == null ? null : value[part];
    return value;
  }

  snapshot() {
    return { version: 1, items: this.items, mode: this.mode, selected: this.selectedIndices,
      current: this.currentIndex, anchor: this.#indices.get(this.#anchor) ?? -1 };
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.items) || !Array.isArray(snapshot.selected)) {
      throw new ControlError('SFUI1603', 'Invalid selection snapshot');
    }
    this.mode = snapshot.mode;
    this.#entries = snapshot.items.map(item => ({ item, key: this.key(item), id: this.#nextIdentity++ }));
    this.#indices = new Map(this.#entries.map((entry, index) => [entry.id, index]));
    this.#selected = new Set(snapshot.selected.map(index => this.#entries[index]?.id).filter(id => id !== undefined));
    this.#anchor = this.#entries[snapshot.anchor]?.id ?? null;
    this.#current = this.#entries[snapshot.current]?.id ?? null;
    this.#publishedSelection = new Map([...this.#selected].map(id => [id, this.#entries[this.#indices.get(id)].item]));
    this.lastSource = null;
    this.sourceVersion = undefined;
  }

  #changed(reason) {
    const current = new Map([...this.#selected].map(id => [id, this.#entries[this.#indices.get(id)].item]));
    const removed = [];
    const added = [];
    for (const [id, item] of this.#publishedSelection) {
      if (!current.has(id) || !Object.is(current.get(id), item)) removed.push(item);
    }
    for (const [id, item] of current) {
      if (!this.#publishedSelection.has(id) || !Object.is(this.#publishedSelection.get(id), item)) added.push(item);
    }
    this.#publishedSelection = current;
    if (removed.length || added.length) {
      this.emit('selectionChanged', { AddedItems: added, RemovedItems: removed, SelectedIndex: this.selectedIndex,
        SelectedIndices: this.selectedIndices, reason });
    }
  }
}
