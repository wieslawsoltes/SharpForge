import { LayoutError, size, rect, sameSize, sameRect } from './geometry.js';
import { measureElement, arrangeElement } from './framework-element-layout.js';
import { defaultLayoutDependencies, scrollGeometryChanged } from './layout-dependencies.js';
import { annotatedVisualChildren } from './annotated-content.js';

const emptySize = Object.freeze(size());
const emptyRect = Object.freeze(rect());

/** Incremental Measure/Arrange owner. A subtree is revisited only when dirty or constrained differently. */
export class LayoutEngine {
  constructor({ registry, measureProvider, resolveChildren, scale = 1, maximumNodes = 20000,
    maximumDepth = 512, maximumPasses = 8, onArrange = () => {}, resolveProperties = node => node.properties ?? {},
    resolveDependencies = defaultLayoutDependencies } = {}) {
    this.registry = registry;
    this.measureProvider = measureProvider;
    this.resolveChildren = resolveChildren ?? defaultChildren;
    this.resolveProperties = resolveProperties;
    this.resolveDependencies = resolveDependencies;
    this.scale = scale;
    this.maximumNodes = maximumNodes;
    this.maximumDepth = maximumDepth;
    this.maximumPasses = maximumPasses;
    this.onArrange = onArrange;
    this.states = new Map();
    this.dependencies = new Map();
    this.roots = [];
    this.dirty = new Set();
    this.phase = null;
    this.depth = 0;
    this.version = 0;
    this.disposed = false;
    this.stats = { measures: 0, arranges: 0, passes: 0 };
  }

  synchronize(nodes, roots) {
    this.assertAlive();
    if (nodes.size > this.maximumNodes) throw new LayoutError('SFUI1603', 'Layout node limit exceeded');
    const removed = new Set(this.states.keys());
    for (const [id, node] of nodes) {
      removed.delete(id);
      let state = this.states.get(id);
      if (!state) {
        state = { id, node, parent: null, children: [], desiredSize: emptySize, unclippedSize: emptySize,
          contentSize: emptySize, renderSize: emptySize, slot: emptyRect, rect: emptyRect,
          constraint: null, measureDirty: true, arrangeDirty: true, measuring: false, arranging: false,
          version: 0, data: Object.create(null) };
        this.states.set(id, state);
      } else if (state.node !== node) this.invalidate(id);
      state.node = node;
      state.parent = null;
    }
    for (const id of removed) this.states.delete(id);
    this.dependencies.clear();
    for (const state of this.states.values()) {
      for (const id of this.resolveDependencies(state.node)) {
        if (!this.dependencies.has(id)) this.dependencies.set(id, new Set());
        this.dependencies.get(id).add(state.id);
      }
      const children = this.resolveChildren(state.node, nodes).filter(id => this.states.has(id));
      if (children.length !== state.children.length || children.some((id, index) => state.children[index] !== id)) {
        state.children = children;
        state.measureDirty = true;
        state.arrangeDirty = true;
      }
      for (const id of children) {
        const child = this.states.get(id);
        if (child.parent && child.parent !== state.id) throw new LayoutError('SFUI1604', 'Visual has multiple layout parents', id);
        child.parent = state.id;
      }
    }
    this.roots = roots.filter(id => this.states.has(id));
    for (const id of this.roots) this.dirty.add(id);
    this.validateTree();
  }

  validateTree() {
    const visited = new Set();
    const active = new Set();
    const visit = (id, depth) => {
      if (depth > this.maximumDepth) throw new LayoutError('SFUI1605', 'Visual tree depth limit exceeded', id);
      if (active.has(id)) throw new LayoutError('SFUI1606', 'Visual tree contains a cycle', id);
      if (visited.has(id)) return;
      active.add(id);
      for (const child of this.states.get(id).children) visit(child, depth + 1);
      active.delete(id);
      visited.add(id);
    };
    for (const id of this.states.keys()) visit(id, 0);
  }

  invalidate(id, kind = 'measure') {
    if (this.disposed) return;
    const queue = [id];
    const seen = new Set();
    for (let index = 0; index < queue.length; index++) {
      const state = this.states.get(queue[index]);
      if (!state || seen.has(state.id)) continue;
      seen.add(state.id);
      if (kind === 'measure') state.measureDirty = true;
      state.arrangeDirty = true;
      this.dirty.add(state.id);
      if (state.parent) queue.push(state.parent);
      for (const dependent of this.dependencies.get(state.id) ?? []) queue.push(dependent);
    }
  }

  setScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0 || scale > 16) throw new RangeError('Invalid rasterization scale');
    if (this.scale === scale) return;
    this.scale = scale;
    for (const id of this.states.keys()) this.invalidate(id, 'arrange');
  }

  context(state) {
    return {
      engine: this, id: state.id, node: state.node, properties: this.propertiesFor(state),
      children: state.children, data: state.data, scale: this.scale,
      measure: (id, available) => this.measure(id, available),
      arrange: (id, slot) => this.arrange(id, slot),
      state: id => this.states.get(id),
      resolve: id => this.states.get(id)?.node,
      invalidate: kind => this.invalidate(state.id, kind),
      suppress: (id, value) => this.suppress(id, value),
      intrinsic: available => this.measureProvider?.measure(state.node, available) ?? emptySize,
      intrinsicOf: (node, available) => this.measureProvider?.measure(node, available) ?? emptySize
    };
  }

  propertiesFor(state) {
    const properties = this.resolveProperties(state.node);
    return state.data.layoutSuppressed ? { ...properties, Visibility: 1 } : properties;
  }

  suppress(id, value) {
    const state = this.states.get(id);
    if (!state || !!state.data.layoutSuppressed === !!value) return;
    state.data.layoutSuppressed = !!value;
    this.invalidate(id);
  }

  measure(id, available) {
    this.assertAlive();
    size(available.width, available.height);
    const state = this.states.get(id);
    if (!state) throw new LayoutError('SFUI1607', 'Unknown layout node', id);
    if (!state.measureDirty && sameSize(state.constraint, available)) return state.desiredSize;
    if (state.measuring) throw new LayoutError('SFUI1608', 'Reentrant MeasureOverride', id);
    state.measuring = true;
    state.measureDirty = false;
    this.stats.measures++;
    try {
      const algorithm = this.registry.resolve(state.node.type);
      const context = this.context(state);
      const measured = measureElement(context.properties, available,
        constraint => algorithm?.measure ? algorithm.measure(context, constraint) : context.intrinsic(constraint));
      state.desiredSize = measured.desired;
      state.unclippedSize = measured.unclipped;
      state.contentSize = measured.content;
      state.constraint = { ...available };
      state.arrangeDirty = true;
      return state.desiredSize;
    } catch (error) {
      state.measureDirty = true;
      throw error;
    } finally {
      state.measuring = false;
    }
  }

  arrange(id, slot) {
    this.assertAlive();
    rect(slot.x, slot.y, slot.width, slot.height);
    const state = this.states.get(id);
    if (!state) throw new LayoutError('SFUI1607', 'Unknown layout node', id);
    if (state.measureDirty) this.measure(id, size(slot.width, slot.height));
    if (!state.arrangeDirty && sameRect(state.slot, slot)) return state.renderSize;
    if (state.arranging) throw new LayoutError('SFUI1609', 'Reentrant ArrangeOverride', id);
    state.arranging = true;
    state.arrangeDirty = false;
    this.stats.arranges++;
    try {
      state.slot = { ...slot };
      state.rect = arrangeElement(this.propertiesFor(state), slot, state.unclippedSize, this.scale);
      state.renderSize = size(state.rect.width, state.rect.height);
      const algorithm = this.registry.resolve(state.node.type);
      const previousScroll = state.data.scroll;
      const arranged = algorithm?.arrange?.(this.context(state), state.renderSize);
      if (arranged !== undefined) {
        const rendered = size(arranged.width, arranged.height);
        if (!Number.isFinite(rendered.width) || !Number.isFinite(rendered.height)) {
          throw new LayoutError('SFUI1613', 'ArrangeOverride must return a finite Size', id);
        }
        state.renderSize = rendered;
        state.rect = { ...state.rect, ...rendered };
      }
      state.version = ++this.version;
      this.onArrange(state);
      if (scrollGeometryChanged(previousScroll, state.data.scroll)) {
        for (const dependent of this.dependencies.get(id) ?? []) this.invalidate(dependent, 'arrange');
      }
      return state.renderSize;
    } catch (error) {
      state.arrangeDirty = true;
      throw error;
    } finally {
      state.arranging = false;
    }
  }

  updateLayout(viewport, { signal } = {}) {
    this.assertAlive();
    if (this.phase) throw new LayoutError('SFUI1610', 'UpdateLayout cannot run during a layout pass');
    rect(0, 0, viewport.width, viewport.height);
    this.phase = 'layout';
    this.stats = { measures: 0, arranges: 0, passes: 0 };
    try {
      do {
        signal?.throwIfAborted();
        this.dirty.clear();
        if (++this.stats.passes > this.maximumPasses) throw new LayoutError('SFUI1611', 'Layout invalidation did not converge');
        for (const id of this.roots) {
          this.measure(id, viewport);
          this.arrange(id, rect(0, 0, viewport.width, viewport.height));
        }
      } while (this.dirty.size);
      return { version: this.version, scale: this.scale, stats: { ...this.stats } };
    } finally {
      this.phase = null;
    }
  }

  snapshot() {
    const result = [];
    const visit = (id, parentX, parentY) => {
      const state = this.states.get(id);
      const bounds = { ...state.rect, x: state.rect.x + parentX, y: state.rect.y + parentY };
      result.push({ id, parentId: state.parent, bounds, rect: { ...state.rect }, slot: { ...state.slot },
        desiredSize: { ...state.desiredSize }, renderSize: { ...state.renderSize }, version: state.version,
        children: [...state.children] });
      for (const child of state.children) visit(child, bounds.x, bounds.y);
    };
    for (const id of this.roots) visit(id, 0, 0);
    return { version: this.version, scale: this.scale, nodes: result };
  }

  assertAlive() {
    if (this.disposed) throw new LayoutError('SFUI1612', 'LayoutEngine has been disposed');
  }

  dispose() {
    this.disposed = true;
    this.states.clear();
    this.dependencies.clear();
    this.dirty.clear();
    this.roots = [];
    this.measureProvider?.dispose?.();
  }
}

/** Only visual ownership edges participate; resources and commands never become layout children. */
export function defaultChildren(node, nodes = null) {
  if (node.templateRoot) return [node.templateRoot];
  const type = node.type.split('.').at(-1);
  if (type === 'AnnotatedScrollBarLabel') return [];
  if (type === 'AnnotatedScrollBar' && nodes) {
    const resolve = typeof nodes === 'function' ? nodes : id => nodes.get(id);
    return annotatedVisualChildren(node, resolve);
  }
  const result = [];
  for (const name of ['Child', 'Content', 'Pane', 'Pane1', 'Pane2']) {
    const value = node.properties?.[name];
    if (value?.$ref) result.push(value.$ref);
  }
  if (type === 'Expander' && node.properties?.Header?.$ref) result.push(node.properties.Header.$ref);
  for (const name of ['Children', 'Items', 'MenuItems', 'TabItems']) {
    for (const value of node.collections?.[name] ?? []) if (value?.$ref) result.push(value.$ref);
  }
  return [...new Set(result)];
}
