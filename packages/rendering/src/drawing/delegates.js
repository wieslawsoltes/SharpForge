import {DrawingContext} from './context.js';
import {DrawingError} from './commands.js';

/** Per-session renderer contributions; no prototype patching or shared mutable registry. */
export class RenderDelegateRegistry {
  constructor({resolveType = () => null} = {}) { this.delegates = new Map(); this.resolveType = resolveType; }
  register(type, render) {
    if (typeof type !== 'string' || typeof render !== 'function' || this.delegates.has(type)) {
      throw new DrawingError('SFRENDER016', 'Invalid or duplicate render delegate');
    }
    this.delegates.set(type, render);
    return this;
  }
  resolve(type) {
    const visited = new Set();
    while (type && !visited.has(type)) {
      visited.add(type);
      const render = this.delegates.get(type) ?? this.delegates.get(type.slice(type.lastIndexOf('.') + 1));
      if (render) return {render, type};
      type = this.resolveType(type)?.base;
    }
    return null;
  }
  get(type) { return this.resolve(type)?.render ?? null; }
  encode(node, layout, resources, options = {}) {
    const match = this.resolve(node.type);
    if (!match) return null;
    const context = new DrawingContext({elementId: node.id, version: options.version ?? node.version ?? 0});
    match.render(match.type === node.type ? node : {...node, type: match.type}, layout, context, resources, options);
    return context.finish(layout?.bounds ?? null);
  }
}

/** Retains element lists across composition-only changes and reports unsupported visuals explicitly. */
export class DisplayListTreeBuilder {
  constructor(registry, resources) {
    this.registry = registry;
    this.resources = resources;
    this.cache = new Map();
    this.metrics = {encoded: 0, retained: 0, unsupported: 0};
  }
  build(nodes, layoutFor, options = {}) {
    const result = [], seen = new Set();
    this.metrics.encoded = this.metrics.retained = this.metrics.unsupported = 0;
    for (const node of nodes) {
      const layout = layoutFor(node.id), version = options.versionFor?.(node) ?? node.version ?? 0;
      if (!layout || node.properties?.Visibility === 1) continue;
      seen.add(node.id);
      const key = `${version}:${layout.contentVersion ?? layout.version ?? 0}`;
      let entry = this.cache.get(node.id);
      if (entry?.key === key) this.metrics.retained++;
      else {
        const list = this.registry.encode(node, layout, this.resources, {...options, version});
        if (!list) { this.metrics.unsupported++; options.onUnsupported?.(node); continue; }
        entry = {key, list};
        this.cache.set(node.id, entry);
        this.metrics.encoded++;
      }
      result.push(entry.list);
    }
    for (const id of this.cache.keys()) if (!seen.has(id)) this.cache.delete(id);
    return result;
  }
  invalidate(id) { this.cache.delete(id); }
  clear() { this.cache.clear(); }
}
