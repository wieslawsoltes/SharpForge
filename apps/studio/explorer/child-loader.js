function page(value) {
  if (Array.isArray(value)) return {nodes: value, hasMore: false, offset: 0};
  if (!value || !Array.isArray(value.nodes) || !Number.isSafeInteger(value.offset) || value.offset < 0) {
    throw new TypeError('Explorer child page requires nodes and a nonnegative safe offset');
  }
  return value;
}

function moreNode(parent, offset) {
  if (!Number.isSafeInteger(offset)) throw new RangeError('Explorer page offset limit exceeded');
  return {id: parent.id + ':more:' + offset, kind: 'load-more', label: 'Load more…', icon: '…', draggable: false,
    parentId: parent.id, offset};
}

/** A loader's function identity survives TreeModel cloning, but changes when its workspace or source snapshot is replaced. */
export class ExplorerChildLoader {
  constructor({model, signal, onUpdate = () => {}}) {
    Object.assign(this, {model, signal, onUpdate});
    this.pending = new Map();
  }

  current(id, loader) {
    const node = this.model.nodes.get(id);
    return !this.signal?.aborted && node?.loadChildren === loader ? node : null;
  }

  request(key, loader, action) {
    const existing = this.pending.get(key);
    if (existing?.loader === loader) return existing.promise;
    const operation = {loader};
    operation.promise = Promise.resolve().then(action).finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation.promise;
  }

  publish(node, children, reveal) {
    // Clone only the changed ancestry. TreeModel validates the staged tree before replacing its current state.
    const replacement = new Map([[node.id, {...node, children, loaded: true, loading: false}]]);
    for (const id of this.model.ancestors(node.id)) {
      const parent = this.model.nodes.get(id);
      replacement.set(id, {...parent, children: parent.children.map(child => replacement.get(child.id) ?? child)});
    }
    this.model.setNodes(this.model.roots.map(root => replacement.get(root.id) ?? root));
    this.onUpdate({reveal});
  }

  expand(node) {
    const loader = node?.loadChildren;
    if (!loader || node.loaded) return Promise.resolve();
    return this.request('expand:' + node.id, loader, async () => {
      if (!this.current(node.id, loader)) return;
      node.loading = true;
      try {
        const response = await loader({offset: 0, limit: 100, signal: this.signal});
        const current = this.current(node.id, loader);
        if (!current) return;
        const result = page(response);
        const children = [...result.nodes];
        if (result.hasMore) children.push(moreNode(current, result.offset + children.length));
        this.publish(current, children, false);
      } finally {
        node.loading = false;
        const current = this.current(node.id, loader);
        if (current) current.loading = false;
      }
    });
  }

  loadMore(node) {
    const parent = this.model.nodes.get(node?.parentId);
    const loader = parent?.loadChildren;
    if (!loader) return Promise.resolve();
    return this.request('page:' + node.id, loader, async () => {
      if (!this.current(parent.id, loader)) return;
      const response = await loader({offset: node.offset, limit: 100, signal: this.signal});
      const current = this.current(parent.id, loader);
      if (!current?.children.some(child => child.id === node.id && child.offset === node.offset)) return;
      const result = page(response);
      const children = [...current.children.filter(child => child.id !== node.id), ...result.nodes];
      if (result.hasMore) children.push(moreNode(current, result.offset + result.nodes.length));
      this.publish(current, children, true);
    });
  }
}
