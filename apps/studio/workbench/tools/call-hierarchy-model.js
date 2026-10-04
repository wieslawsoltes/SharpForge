import {cancellable} from '../events.js';

function stale() { throw new Error('Call hierarchy is stale; refresh the root'); }

/** Lazy call results retain the compiler project and exact source identities that produced them. */
export class CallHierarchyModel {
  constructor({request, documents}) {
    this.request = request;
    this.documents = documents;
    this.roots = [];
    this.controllers = new Set();
    this.disposed = false;
  }

  capture(uri, version) {
    const record = this.documents.get(uri);
    if (!record || version !== undefined && record.version !== version) stale();
    return {uri, record, model: record.model, version: record.version};
  }

  assertCurrent(source) {
    const current = this.documents.get(source.uri);
    if (this.disposed || current !== source.record || current?.model !== source.model || current?.version !== source.version) stale();
  }

  async operation(signal, action) {
    if (this.disposed) throw new Error('Call hierarchy is disposed');
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    this.controllers.add(controller);
    try {
      const result = await cancellable(action(controller.signal), controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  async prepare(location, {signal} = {}) {
    const origin = this.capture(location.uri, location.version);
    return this.operation(signal, async requestSignal => {
      const items = await this.request('callHierarchy', {uri: location.uri, version: origin.version,
        offset: location.offset ?? location.start, projectId: location.projectId}, {signal: requestSignal});
      requestSignal.throwIfAborted();
      this.assertCurrent(origin);
      const roots = items.map(item => {
        const projectId = item.projectId ?? location.projectId;
        return this.node(item, `root:${projectId ?? ''}:${item.id}`, {origin, projectId});
      });
      for (const root of roots) {
        const existing = this.roots.findIndex(item => item.id === root.id);
        if (existing < 0) this.roots.push(root);
        else this.roots[existing] = root;
      }
      return roots;
    });
  }

  node(item, id, owner, ranges = []) {
    const source = this.capture(item.uri, item.version);
    const projectId = owner.projectId;
    if (item.projectId !== undefined && item.projectId !== projectId) stale();
    const value = {...item, projectId, version: source.version};
    const rangeSources = new Map(ranges.map(range => [range.uri, this.capture(range.uri, range.version)]));
    const base = {item: value, projectId, version: source.version, source, origin: owner.origin};
    return {...base, id, label: item.detail ?? item.name, detail: item.detail ?? item.name,
      rangeSources, ranges: ranges.map(range => ({...range, projectId, version: rangeSources.get(range.uri).version})),
      children: ['incoming', 'outgoing'].map(direction => ({...base, id: `${id}:${direction}`,
        label: direction === 'incoming' ? 'Calls To' : 'Calls From', direction, branch: true, children: []}))};
  }

  async expand(node, {signal} = {}) {
    this.assertCurrent(node.origin);
    this.assertCurrent(node.source);
    if (!node.direction || node.loaded) return;
    if (node.pending) return node.pending;
    const pending = this.operation(signal, async requestSignal => {
      const calls = await this.request(node.direction === 'incoming' ? 'incomingCalls' : 'outgoingCalls', {
        uri: node.item.uri, version: node.version, projectId: node.projectId, item: node.item
      }, {signal: requestSignal});
      requestSignal.throwIfAborted();
      this.assertCurrent(node.origin);
      this.assertCurrent(node.source);
      node.children = calls.map((call, index) => this.node(call.item, `${node.id}:${index}`, node, call.ranges));
      node.loaded = true;
    });
    node.pending = pending;
    try { return await pending; }
    finally { node.pending = null; }
  }

  /** Validate the root and target before every symbol or call-site navigation. */
  location(node, range) {
    this.assertCurrent(node.origin);
    this.assertCurrent(node.source);
    if (range) {
      if (!node.ranges.includes(range)) throw new Error('Call site does not belong to this hierarchy node');
      this.assertCurrent(node.rangeSources.get(range.uri));
      return {...range, projectId: node.projectId};
    }
    return {...node.item, start: node.item.selectionStart ?? node.item.start,
      end: node.item.selectionEnd ?? node.item.end, projectId: node.projectId, version: node.version};
  }

  clear() {
    for (const controller of this.controllers) controller.abort();
    this.roots = [];
  }

  dispose() { this.disposed = true; this.clear(); }
}
