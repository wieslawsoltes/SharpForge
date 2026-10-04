import {CompositionObject} from './composition-object.js';
import {finite} from './values.js';

/** Bounded IList<float>/IVector<float> projection; every edit invalidates the owning shape. */
export class CompositionStrokeDashArray extends CompositionObject {
  constructor(compositor, owner) {
    super(compositor, 'CompositionStrokeDashArray');
    this.owner = owner;
    this.items = [];
  }
  get Count() { this.ensureAlive(); return this.items.length; }
  get Size() { return this.Count; }
  get IsReadOnly() { this.ensureAlive(); return false; }
  [Symbol.iterator]() { this.ensureAlive(); return this.items[Symbol.iterator](); }
  ensureAlive() { if (this.closed || this.owner?.closed) throw new Error('Composition stroke dash array is disposed'); }
  index(index, allowEnd = false) {
    this.ensureAlive();
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length + Number(allowEnd)) {
      throw new RangeError('Composition stroke dash index out of range');
    }
    return index;
  }
  changed() {
    super.changed('Items');
    this.owner?.changed('StrokeDashArray');
  }
  get_Item(index) { return this.items[this.index(index)]; }
  GetAt(index) { return this.get_Item(index); }
  set_Item(index, value) {
    this.index(index);
    this.items[index] = finite(value, 'StrokeDashArray entry', 0);
    this.changed();
  }
  SetAt(index, value) { this.set_Item(index, value); }
  InsertAt(index, value) {
    this.index(index, true);
    if (this.items.length >= 256) throw new RangeError('Composition stroke dash limit exceeded');
    this.items.splice(index, 0, finite(value, 'StrokeDashArray entry', 0));
    this.changed();
  }
  Insert(index, value) { this.InsertAt(index, value); }
  Add(value) { this.InsertAt(this.items.length, value); }
  Append(value) { this.Add(value); }
  RemoveAt(index) { this.items.splice(this.index(index), 1); this.changed(); }
  RemoveAtEnd() { this.RemoveAt(this.items.length - 1); }
  IndexOf(value) { this.ensureAlive(); return this.items.indexOf(finite(value, 'StrokeDashArray entry', 0)); }
  Contains(value) { return this.IndexOf(value) >= 0; }
  Remove(value) {
    const index = this.IndexOf(value);
    if (index < 0) return false;
    this.RemoveAt(index);
    return true;
  }
  Clear() { this.ensureAlive(); if (this.items.length) { this.items.length = 0; this.changed(); } }
  ReplaceAll(values) { this.ensureAlive(); this.restoreValues(values); this.changed(); }
  restoreValues(values) {
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length > 256 || values.length === undefined) {
      throw new TypeError('Composition stroke dash array requires at most 256 scalar values');
    }
    const next = Array.from(values, value => finite(value, 'StrokeDashArray entry', 0));
    this.items = next;
  }
  CopyTo(array, index) {
    this.ensureAlive();
    if ((!Array.isArray(array) && !ArrayBuffer.isView(array)) || !Number.isInteger(array.length) || !Number.isInteger(index)
      || index < 0 || index + this.items.length > array.length) throw new RangeError('Invalid stroke dash destination');
    for (let offset = 0; offset < this.items.length; offset++) array[index + offset] = this.items[offset];
  }
  GetMany(index, array) {
    this.index(index, true);
    if ((!Array.isArray(array) && !ArrayBuffer.isView(array)) || !Number.isInteger(array.length)) {
      throw new TypeError('Invalid stroke dash destination');
    }
    const count = Math.min(array.length, this.items.length - index);
    for (let offset = 0; offset < count; offset++) array[offset] = this.items[index + offset];
    return count;
  }
  *retainedValues() { yield* super.retainedValues(); yield this.owner; }
  snapshot() { return {...super.snapshot(), items: [...this.items], owner: this.owner}; }
  restore(snapshot) { super.restore(snapshot); this.restoreValues(snapshot.items); this.owner = snapshot.owner; }
}
