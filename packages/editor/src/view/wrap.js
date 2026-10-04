/** Greedy grapheme-safe soft wrapping with indentation-aware continuation. */
export function wrapLine(layout, width, {indent = 0, enabled = true} = {}) {
  if (!Number.isFinite(width) || width <= 0) throw new RangeError('Wrap width must be positive');
  if (!enabled || layout.width <= width) return [{start: 0, end: layout.text.length, x: 0, indent: 0}];
  const result = [];
  const {pixels, offsets, text} = layout;
  let start = 0;
  while (start < offsets.length - 1) {
    const padding = result.length ? Math.min(indent, width / 2) : 0;
    const available = Math.max(1, width - padding);
    let end = start + 1;
    let whitespace = -1;
    while (end < offsets.length && pixels[end] - pixels[start] <= available) {
      if (/\s/.test(text.slice(offsets[end - 1], offsets[end])) && end > start + 1) whitespace = end;
      end++;
    }
    end = Math.max(start + 1, end - 1);
    if (end < offsets.length - 1 && whitespace > start) end = whitespace;
    result.push({start: offsets[start], end: offsets[end], x: pixels[start], indent: padding});
    start = end;
  }
  return result;
}

/** Fenwick indexed visual row counts. Updates and inverse mapping are O(log logical lines). */
export class VisualLineMap {
  constructor(lineCount = 1) { this.reset(lineCount); }

  reset(lineCount) {
    if (!Number.isSafeInteger(lineCount) || lineCount < 1) throw new RangeError('Invalid logical line count');
    this.counts = new Uint32Array(lineCount);
    this.counts.fill(1);
    this.tree = new Float64Array(lineCount + 1);
    for (let index = 1; index <= lineCount; index++) this.tree[index] = index & -index;
  }

  get lineCount() { return this.counts.length; }
  get rowCount() { return this.rowAt(this.lineCount); }

  set(line, count) {
    if (line < 0 || line >= this.lineCount || !Number.isInteger(count) || count < 0) throw new RangeError('Invalid visual line');
    const delta = count - this.counts[line];
    if (!delta) return;
    this.counts[line] = count;
    for (let index = line + 1; index < this.tree.length; index += index & -index) this.tree[index] += delta;
  }

  rowAt(line) {
    let sum = 0;
    for (let index = Math.min(this.lineCount, Math.max(0, line)); index > 0; index -= index & -index) sum += this.tree[index];
    return sum;
  }

  lineAt(row) {
    let target = Math.max(0, Math.min(Math.max(0, this.rowCount - 1), row));
    let index = 0;
    let step = 2 ** Math.floor(Math.log2(this.lineCount));
    for (; step; step >>>= 1) {
      const next = index + step;
      if (next < this.tree.length && this.tree[next] <= target) {
        index = next;
        target -= this.tree[next];
      }
    }
    return {line: Math.min(this.lineCount - 1, index), continuation: target};
  }
}
