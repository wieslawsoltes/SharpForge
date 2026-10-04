import { ControlEvents, ControlError } from '../policy/events.js';

/** Group runs index existing items without copying their values or changing selection indices. */
export class GroupedItemIndex {
  constructor(items = [], keyOf = value => value?.Group) { this.setItems(items, keyOf); }
  setItems(items, keyOf) {
    if (!Array.isArray(items) || items.length > 1_000_000 || typeof keyOf !== 'function') {
      throw new ControlError('SFUI1609', 'Grouped items require a bounded source and a key selector');
    }
    this.count = items.length;
    this.groups = [];
    for (let index = 0; index < items.length; index++) {
      const key = keyOf(items[index], index);
      const previous = this.groups.at(-1);
      if (previous && Object.is(previous.key, key)) previous.length++;
      else this.groups.push({ key, first: index, length: 1 });
    }
  }
  groupAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count) return null;
    let low = 0;
    let high = this.groups.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.groups[middle].first <= index) low = middle + 1;
      else high = middle;
    }
    return this.groups[low - 1] ?? null;
  }
  indexOfKey(key) { return this.groups.find(group => Object.is(group.key, key))?.first ?? -1; }
}

/** Header objects are supplied by the shared CollectionView/GroupStyle generator. */
export class ViewportGroupIndex {
  constructor(records, count) {
    if (!Array.isArray(records) || records.length > 2048) throw new ControlError('SFUI1609', 'Invalid sparse group records');
    this.count = count;
    this.groups = records.map(record => {
      if (!Number.isInteger(record.startIndex) || !Number.isInteger(record.count) || record.startIndex < 0
        || record.count < 0 || record.startIndex + record.count > count) {
        throw new ControlError('SFUI1609', 'Sparse group bounds are outside the item source');
      }
      return { key: record.group, first: record.startIndex, length: record.count, header: record.header, index: record.index };
    }).sort((left, right) => left.first - right.first);
    for (let index = 1; index < this.groups.length; index++) {
      const previous = this.groups[index - 1];
      if (previous.first + previous.length > this.groups[index].first) throw new ControlError('SFUI1609', 'Sparse groups overlap');
    }
  }
  groupAt(index) {
    return this.groups.find(group => index >= group.first && index < group.first + group.length) ?? null;
  }
  indexOfKey(key) {
    return this.groups.find(group => Object.is(group.key, key) || key?.$ref && group.key?.$ref === key.$ref)?.first ?? -1;
  }
}

/** View changes transfer the current group anchor before reporting completion. */
export class SemanticZoomModel extends ControlEvents {
  constructor({ active = true, canChange = true, capture = () => null, restore = () => {} } = {}) {
    super();
    this.active = active;
    this.canChange = canChange;
    this.capture = capture;
    this.restoreAnchor = restore;
    this.anchor = null;
    this.changing = false;
  }
  toggle(active = !this.active) {
    if (!this.canChange || this.active === !!active || this.changing) return false;
    this.changing = true;
    const previous = this.active;
    try {
      const anchor = this.capture(previous);
      const args = this.emit('ViewChangeStarted', { IsZoomedInViewActive: !!active, SourceItem: anchor, Cancel: false });
      if (args.Cancel) return false;
      this.restoreAnchor(!!active, anchor);
      this.anchor = anchor;
      this.active = !!active;
      this.emit('ViewChangeCompleted', { IsZoomedInViewActive: this.active, DestinationItem: anchor });
      return true;
    } finally { this.changing = false; }
  }
  snapshot() {
    if (this.changing) throw new ControlError('SFUI1609', 'Cannot snapshot an active semantic view change');
    return { version: 1, active: this.active, canChange: this.canChange, anchor: this.anchor };
  }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new ControlError('SFUI1609', 'Invalid semantic-zoom snapshot');
    this.active = snapshot.active;
    this.canChange = snapshot.canChange;
    this.anchor = snapshot.anchor;
  }
  *retainedValues() { yield this.anchor; }
}
