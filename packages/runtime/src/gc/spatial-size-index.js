function height(node) {
  return node?.height ?? 0;
}

function refresh(node) {
  node.height = Math.max(height(node.left), height(node.right)) + 1;
  return node;
}

function rotateLeft(node) {
  const next = node.right;
  node.right = next.left;
  next.left = refresh(node);
  return refresh(next);
}

function rotateRight(node) {
  const next = node.left;
  node.left = next.right;
  next.right = refresh(node);
  return refresh(next);
}

function balance(node) {
  if (!node) return null;
  refresh(node);
  if (height(node.left) - height(node.right) > 1) {
    if (height(node.left.left) < height(node.left.right)) node.left = rotateLeft(node.left);
    return rotateRight(node);
  }
  if (height(node.right) - height(node.left) > 1) {
    if (height(node.right.right) < height(node.right.left)) node.right = rotateRight(node.right);
    return rotateLeft(node);
  }
  return node;
}

function insert(node, block, compare) {
  if (!node) return {block, left: null, right: null, height: 1};
  if (compare(block, node.block) < 0) node.left = insert(node.left, block, compare);
  else node.right = insert(node.right, block, compare);
  return balance(node);
}

function remove(node, block, compare) {
  if (!node) return null;
  const order = compare(block, node.block);
  if (order < 0) node.left = remove(node.left, block, compare);
  else if (order > 0) node.right = remove(node.right, block, compare);
  else {
    if (!node.left) return node.right;
    if (!node.right) return node.left;
    let successor = node.right;
    while (successor.left) successor = successor.left;
    node.block = successor.block;
    node.right = remove(node.right, successor.block, compare);
  }
  return balance(node);
}

/** AVL index ordered first by byte size, then by the supplied stable identity. */
export class SpatialSizeIndex {
  constructor(compare) {
    this.compare = compare;
    this.root = null;
    this.size = 0;
  }

  clear() {
    this.root = null;
    this.size = 0;
  }

  add(block) {
    this.root = insert(this.root, block, this.compare);
    this.size++;
  }

  remove(block) {
    this.root = remove(this.root, block, this.compare);
    this.size--;
  }

  find(size) {
    let node = this.root;
    let best = null;
    while (node) {
      if (node.block.size >= size) {
        best = node.block;
        node = node.left;
      } else node = node.right;
    }
    return best;
  }

  get largest() {
    let node = this.root;
    if (!node) return 0;
    while (node.right) node = node.right;
    return node.block.size;
  }
}
