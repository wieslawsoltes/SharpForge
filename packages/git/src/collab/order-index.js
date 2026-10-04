/** AVL order-statistic index. Marker weights are UTF-16 code units, either zero or one. */
export class OrderIndex {
  constructor() {
    this.root = null;
  }

  get length() {
    return visible(this.root);
  }

  createMarker(atom = null, weight = 0) {
    return { atom, weight, left: null, right: null, parent: null, height: 1, size: 1, visible: weight };
  }

  insertBefore(reference, marker) {
    const offset = reference ? this.rank(reference) : size(this.root);
    this.root = insertAt(this.root, offset, marker);
    this.root.parent = null;
  }

  rank(marker) {
    let result = size(marker.left);
    for (let current = marker; current.parent; current = current.parent) {
      if (current === current.parent.right) result += size(current.parent.left) + 1;
    }
    return result;
  }

  offsetOf(marker) {
    let result = visible(marker.left);
    for (let current = marker; current.parent; current = current.parent) {
      if (current === current.parent.right) result += visible(current.parent.left) + current.parent.weight;
    }
    return result;
  }

  at(offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= this.length) return null;
    let current = this.root;
    while (current) {
      const before = visible(current.left);
      if (offset < before) current = current.left;
      else if (current.weight && offset === before) return current;
      else {
        offset -= before + current.weight;
        current = current.right;
      }
    }
    return null;
  }

  setWeight(marker, weight) {
    marker.weight = weight;
    for (let current = marker; current; current = current.parent) refresh(current);
  }

  *range(offset = 0, count = this.length - offset) {
    let current = this.at(offset);
    while (current && count > 0) {
      if (current.weight) {
        yield current.atom;
        count--;
      }
      current = successorVisible(current);
    }
  }
}

/** Per-anchor AVL map keeps sibling lookup logarithmic even for concurrent insert bursts. */
export class ChildIndex {
  constructor(compare) {
    this.root = null;
    this.compare = compare;
  }

  insert(atom) {
    this.root = insertKey(this.root, atom, this.compare);
    this.root.parent = null;
  }

  after(atom) {
    let current = this.root;
    let result = null;
    while (current) {
      if (this.compare(atom, current.atom) < 0) {
        result = current.atom;
        current = current.left;
      } else current = current.right;
    }
    return result;
  }
}

function height(node) {
  return node?.height ?? 0;
}

function size(node) {
  return node?.size ?? 0;
}

function visible(node) {
  return node?.visible ?? 0;
}

function refresh(node) {
  node.height = Math.max(height(node.left), height(node.right)) + 1;
  node.size = size(node.left) + size(node.right) + 1;
  node.visible = visible(node.left) + visible(node.right) + node.weight;
  return node;
}

function rotateLeft(node) {
  const top = node.right;
  node.right = top.left;
  if (node.right) node.right.parent = node;
  top.left = node;
  top.parent = node.parent;
  node.parent = top;
  refresh(node);
  return refresh(top);
}

function rotateRight(node) {
  const top = node.left;
  node.left = top.right;
  if (node.left) node.left.parent = node;
  top.right = node;
  top.parent = node.parent;
  node.parent = top;
  refresh(node);
  return refresh(top);
}

function balance(node) {
  refresh(node);
  const difference = height(node.left) - height(node.right);
  if (difference > 1) {
    if (height(node.left.left) < height(node.left.right)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (difference < -1) {
    if (height(node.right.right) < height(node.right.left)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}

function insertAt(root, offset, node) {
  if (!root) return node;
  const leftSize = size(root.left);
  if (offset <= leftSize) {
    root.left = insertAt(root.left, offset, node);
    root.left.parent = root;
  } else {
    root.right = insertAt(root.right, offset - leftSize - 1, node);
    root.right.parent = root;
  }
  return balance(root);
}

function insertKey(root, atom, compare) {
  if (!root) return { atom, weight: 0, left: null, right: null, parent: null, height: 1, size: 1, visible: 0 };
  if (compare(atom, root.atom) < 0) {
    root.left = insertKey(root.left, atom, compare);
    root.left.parent = root;
  } else {
    root.right = insertKey(root.right, atom, compare);
    root.right.parent = root;
  }
  return balance(root);
}

function successorVisible(node) {
  if (visible(node.right)) {
    node = node.right;
    while (node) {
      if (visible(node.left)) node = node.left;
      else if (node.weight) return node;
      else node = node.right;
    }
  }
  while (node.parent) {
    const parent = node.parent;
    if (node === parent.left) {
      if (parent.weight) return parent;
      if (visible(parent.right)) return successorVisible(parent);
    }
    node = parent;
  }
  return null;
}
