/** Persistent AVL rope internals. Every node summarizes UTF-16 length and logical line breaks. */
function upperBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Scan an immutable original/add buffer once; pieces subsequently use indexed subranges. */
export function createStore(text) {
  let count = 0;
  const counts = { cr: 0, lf: 0, crlf: 0 };
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code === 13 || code === 10) {
      const pair = code === 13 && text.charCodeAt(offset + 1) === 10;
      counts[pair ? 'crlf' : code === 13 ? 'cr' : 'lf']++;
      if (pair) offset++;
      count++;
    }
  }
  const endings = new Uint32Array(count);
  const types = Object.fromEntries(Object.entries(counts).map(([key, size]) => [key, new Uint32Array(size)]));
  const indices = { cr: 0, lf: 0, crlf: 0 };
  let index = 0;
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code === 13 || code === 10) {
      const pair = code === 13 && text.charCodeAt(offset + 1) === 10;
      const type = pair ? 'crlf' : code === 13 ? 'cr' : 'lf';
      if (pair) offset++;
      endings[index++] = offset + 1;
      types[type][indices[type]++] = offset + 1;
    }
  }
  return Object.freeze({ text, endings, ...types });
}

export function leaf(store, start = 0, length = store.text.length) {
  if (!length) return null;
  const end = start + length;
  const firstBreak = upperBound(store.endings, start);
  const indexedBreaks = upperBound(store.endings, end) - firstBreak;
  const splitCRLF = store.text.charCodeAt(end - 1) === 13 && store.text.charCodeAt(end) === 10;
  const startsLF = store.text.charCodeAt(start) === 10 && store.text.charCodeAt(start - 1) === 13;
  const cr = upperBound(store.cr, end) - upperBound(store.cr, start) + Number(splitCRLF);
  const lf = upperBound(store.lf, end) - upperBound(store.lf, start) + Number(startsLF);
  const crlf = upperBound(store.crlf, end) - upperBound(store.crlf, start) - Number(startsLF);
  return Object.freeze({
    cr, lf, crlf,
    store, start, length, firstBreak, indexedBreaks,
    breaks: indexedBreaks + Number(splitCRLF),
    first: store.text.charCodeAt(start), last: store.text.charCodeAt(end - 1),
    height: 1, pieces: 1, left: null, right: null
  });
}

function branch(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (left.store && left.store === right.store && left.start + left.length === right.start) {
    return leaf(left.store, left.start, left.length + right.length);
  }
  const seam = Number(left.last === 13 && right.first === 10);
  return Object.freeze({
    cr: left.cr + right.cr - seam, lf: left.lf + right.lf - seam, crlf: left.crlf + right.crlf + seam,
    store: null, left, right,
    length: left.length + right.length,
    breaks: left.breaks + right.breaks - Number(left.last === 13 && right.first === 10),
    first: left.first, last: right.last,
    height: Math.max(left.height, right.height) + 1,
    pieces: left.pieces + right.pieces
  });
}

function rebalance(left, right) {
  if (!left || !right) return left ?? right;
  if (left.height > right.height + 1) {
    if (left.left.height >= left.right.height) return branch(left.left, branch(left.right, right));
    return branch(branch(left.left, left.right.left), branch(left.right.right, right));
  }
  if (right.height > left.height + 1) {
    if (right.right.height >= right.left.height) return branch(branch(left, right.left), right.right);
    return branch(branch(left, right.left.left), branch(right.left.right, right.right));
  }
  return branch(left, right);
}

/** Concatenate ordered trees with logarithmic path copying; no input node is modified. */
export function concat(left, right) {
  if (!left || !right) return left ?? right;
  if (left.height > right.height + 1) return rebalance(left.left, concat(left.right, right));
  if (right.height > left.height + 1) return rebalance(concat(left, right.left), right.right);
  return branch(left, right);
}

export function split(root, offset) {
  if (!root) return [null, null];
  if (offset <= 0) return [null, root];
  if (offset >= root.length) return [root, null];
  if (root.store) return [leaf(root.store, root.start, offset), leaf(root.store, root.start + offset, root.length - offset)];
  if (offset < root.left.length) {
    const [before, after] = split(root.left, offset);
    return [before, concat(after, root.right)];
  }
  const [before, after] = split(root.right, offset - root.left.length);
  return [concat(root.left, before), after];
}

export function replace(root, start, end, text) {
  const [before, rest] = split(root, start);
  const [, after] = split(rest, end - start);
  return concat(concat(before, text ? leaf(createStore(text)) : null), after);
}

export function charCodeAt(root, offset) {
  if (!root || offset < 0 || offset >= root.length) return NaN;
  let node = root;
  let local = offset;
  while (!node.store) {
    if (local < node.left.length) node = node.left;
    else {
      local -= node.left.length;
      node = node.right;
    }
  }
  return node.store.text.charCodeAt(node.start + local);
}

/** Yield only intersecting pieces, in O(log pieces + visited pieces). */
export function* chunks(root, start = 0, end = root?.length ?? 0) {
  if (!root || start >= end) return;
  if (root.store) {
    yield root.store.text.slice(root.start + start, root.start + end);
    return;
  }
  const boundary = root.left.length;
  if (start < boundary) yield* chunks(root.left, start, Math.min(end, boundary));
  if (end > boundary) yield* chunks(root.right, Math.max(0, start - boundary), end - boundary);
}

/** Count completed breaks at offset. A CR followed by LF completes only after the LF. */
export function breaksBefore(root, offset) {
  if (!root || offset <= 0) return 0;
  if (offset >= root.length) return root.breaks;
  if (root.store) return upperBound(root.store.endings, root.start + offset) - root.firstBreak;
  if (offset < root.left.length) return breaksBefore(root.left, offset);
  return root.left.breaks + breaksBefore(root.right, offset - root.left.length)
    - Number(root.left.last === 13 && root.right.first === 10);
}

/** Select the end of the nth logical break (one based). */
export function breakOffset(root, ordinal) {
  if (!root || ordinal < 1 || ordinal > root.breaks) throw new RangeError('Line break index outside text');
  if (root.store) {
    return ordinal > root.indexedBreaks ? root.length : root.store.endings[root.firstBreak + ordinal - 1] - root.start;
  }
  const left = root.left;
  const seam = left.last === 13 && root.right.first === 10;
  if (ordinal < left.breaks || ordinal === left.breaks && !seam) return breakOffset(left, ordinal);
  if (ordinal === left.breaks && seam) return left.length + 1;
  return left.length + breakOffset(root.right, ordinal - left.breaks + Number(seam));
}

export function treeStatistics(root) {
  return Object.freeze({ length: root?.length ?? 0, pieces: root?.pieces ?? 0, height: root?.height ?? 0 });
}
