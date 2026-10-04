import {stageChildPages} from './child-page.js';

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

  publish(node, value, reveal) {
    this.model.setNodes(stageChildPages(this.model, [{parentId: node.id, page: value}]));
    this.onUpdate({reveal});
  }

  admitPages(pages) {
    if (this.signal?.aborted) return false;
    // Validate the whole ancestor chain together. An invalid later page cannot leave an earlier page published.
    this.model.setNodes(stageChildPages(this.model, pages));
    this.onUpdate({reveal: false});
    return true;
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
        if (!Array.isArray(response) && response?.offset !== 0) throw new RangeError('Explorer expansion returned a different page');
        this.publish(current, response, false);
      } catch (error) {
        if (this.current(node.id, loader)) throw error;
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
      let response;
      try { response = await loader({offset: node.offset, limit: 100, signal: this.signal}); }
      catch (error) { if (this.current(parent.id, loader)) throw error; return; }
      const current = this.current(parent.id, loader);
      if (!current?.children.some(child => child.id === node.id && child.offset === node.offset)) return;
      if (response?.offset !== node.offset) throw new RangeError('Explorer pagination returned a different page');
      this.publish(current, response, true);
    });
  }
}
