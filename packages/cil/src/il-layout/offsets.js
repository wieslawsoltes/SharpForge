/** Prefix-sum index with O(log n) queries and monotone branch-size updates. */
export class LayoutOffsets {
  constructor(sizes) {
    this.tree = new Uint32Array(sizes.length + 1);
    for (let index = 1; index < this.tree.length; index++) {
      this.tree[index] += sizes[index - 1];
      const parent = index + (index & -index);
      if (parent < this.tree.length) this.tree[parent] += this.tree[index];
    }
  }

  before(index) {
    let offset = 0;
    for (; index > 0; index -= index & -index) offset += this.tree[index];
    return offset;
  }

  widen(index) {
    for (index++; index < this.tree.length; index += index & -index) this.tree[index] += 3;
  }
}
