import { ExceptionRegionCursor } from './cursor.js';
import { checkRegionCancellation } from './contracts.js';

/** Index lexical membership once: O(R log R) construction, O(log R) point lookup, O(R) storage. */
export class ExceptionTransferIndex {
  #offsets;
  #members;
  #entry;
  #tree;
  #count = 0;

  constructor(tree, signal) {
    this.#tree = tree;
    const offsets = [0];
    for (const region of tree.regions) offsets.push(region.start, region.end);
    offsets.sort((left, right) => left - right);
    this.#offsets = new Uint32Array(offsets.length);
    this.#members = new Int32Array(offsets.length);
    this.#entry = new Int32Array(tree.regions.length).fill(-1);
    const cursor = new ExceptionRegionCursor(tree);
    let previous = -1;
    // Visit every boundary, including empty gaps, so the cursor never skips an entire region.
    for (const offset of offsets) {
      if (offset === previous) continue;
      checkRegionCancellation(signal);
      cursor.advance(offset);
      this.#offsets[this.#count] = offset;
      this.#members[this.#count++] = cursor.region?.id ?? -1;
      previous = offset;
    }
    const pending = [...tree.roots].reverse();
    while (pending.length) {
      checkRegionCancellation(signal);
      const region = tree.regions[pending.pop()];
      const parent = region.parent === null ? null : tree.regions[region.parent];
      // Several nested tries can begin at the same instruction. Entry is permitted through all of them.
      this.#entry[region.id] = region.kind !== 'try' ? region.id
        : parent?.start === region.start ? this.#entry[parent.id] : parent?.id ?? -1;
      for (let index = region.children.length - 1; index >= 0; index--) pending.push(region.children[index]);
    }
  }

  regionAt(offset) {
    let low = 0;
    let high = this.#count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.#offsets[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    return low ? this.#tree.regions[this.#members[low - 1]] ?? null : null;
  }

  /** Deepest target region requiring an already-enclosed source; first instructions of tries are exempt. */
  entryRegion(target, region) {
    if (!region || target !== region.start) return region;
    return this.#tree.regions[this.#entry[region.id]] ?? null;
  }
}
