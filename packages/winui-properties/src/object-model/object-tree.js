import {ResourceFault} from '../resources/errors.js';
import {copyViewportPayload, sameViewportPayload} from './layout-event-values.js';

/** One application owns separate logical and visual trees, with stable IDs and explicit lifecycle notifications. */
export class UIObjectTree {
  constructor({maxNodes = 1000000, maxDepth = 1024, onLogicalParentChanged = null, onEvent = null} = {}) {
    this.maxNodes = maxNodes;
    this.maxDepth = maxDepth;
    this.onLogicalParentChanged = onLogicalParentChanged;
    this.onEvent = onEvent;
    this.nodes = new Map();
    this.roots = new Set();
  }

  register(id, {value = id, root = false} = {}) {
    const existing = this.nodes.get(id);
    if (existing) {
      if (value !== id || existing.value === id) existing.value = value;
      if (root) this.roots.add(id);
      return existing;
    }
    if (this.nodes.size >= this.maxNodes) throw new ResourceFault('SFTREE001', 'UI tree node budget exceeded.');
    const node = {id, value, visualParent: null, logicalParent: null, visualChildren: new Set(), logicalChildren: new Set(),
      connected: false, bounds: {x: 0, y: 0, width: 0, height: 0}, visible: true, hitTestVisible: true, viewport: null};
    this.nodes.set(id, node);
    if (root) this.roots.add(id);
    return node;
  }

  require(id) {
    const node = this.nodes.get(id);
    if (!node) throw new ResourceFault('SFTREE002', 'UI element is not registered in this tree.');
    return node;
  }

  contains(id) { return this.nodes.has(id); }
  getValue(id) { return id === null ? null : this.require(id).value; }
  getVisualParent(id) { return this.require(id).visualParent; }
  getLogicalParent(id) { return this.require(id).logicalParent; }
  getVisualChildren(id) { return [...this.require(id).visualChildren]; }
  getLogicalChildren(id) { return [...this.require(id).logicalChildren]; }
  setVisualParent(id, parent) { this.setParent(id, parent, 'visual'); }
  setLogicalParent(id, parent) { this.setParent(id, parent, 'logical'); }

  setParent(id, parent, kind) {
    const child = this.require(id);
    const key = kind + 'Parent';
    const children = kind + 'Children';
    if (child[key] === parent) return;
    const visited = new Set([id]);
    for (let current = parent; current !== null; current = this.require(current)[key]) {
      if (visited.has(current) || visited.size >= this.maxDepth) throw new ResourceFault('SFTREE003', 'Cyclic or over-depth UI ancestry.');
      visited.add(current);
    }
    const previous = child[key];
    if (kind === 'logical') this.onLogicalParentChanged?.(child.value,
      parent === null ? null : this.require(parent).value, previous === null ? null : this.require(previous).value);
    if (previous !== null) this.require(previous)[children].delete(id);
    child[key] = parent;
    if (parent !== null) this.require(parent)[children].add(id);
    if (kind === 'visual' && child.connected !== (parent !== null && this.require(parent).connected)) {
      this.setConnected(id, parent !== null && this.require(parent).connected);
    }
  }

  setBounds(id, bounds, {renderSize = bounds, notify = true} = {}) {
    if (!['x', 'y', 'width', 'height'].every(name => Number.isFinite(bounds[name])) || bounds.width < 0 || bounds.height < 0) {
      throw new ResourceFault('SFTREE004', 'Layout bounds must be finite with non-negative size.');
    }
    const node = this.require(id);
    if (!['width', 'height'].every(name => Number.isFinite(renderSize[name]) && renderSize[name] >= 0)) {
      throw new ResourceFault('SFTREE004', 'Layout sizes must be finite and non-negative.');
    }
    const previous = node.layoutSize ?? node.bounds;
    node.bounds = {...bounds};
    node.layoutSize = {width: renderSize.width, height: renderSize.height};
    if (notify && (previous.width !== renderSize.width || previous.height !== renderSize.height)) {
      this.onEvent?.(node.value, 'SizeChanged', {PreviousSize: {width: previous.width, height: previous.height},
        NewSize: {...node.layoutSize}});
    }
  }

  setEffectiveViewport(id, viewport, {notify = true} = {}) {
    const node = this.require(id);
    const value = copyViewportPayload(viewport);
    if (sameViewportPayload(node.viewport, value)) return;
    node.viewport = value;
    if (notify && node.connected && node.visible) this.onEvent?.(node.value, 'EffectiveViewportChanged', copyViewportPayload(value));
  }

  layoutUpdated(ids = this.nodes.keys()) {
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node?.connected && node.visible) this.onEvent?.(node.value, 'LayoutUpdated', {});
    }
  }

  setConnected(id, connected) {
    const nodes = this.descendants(id);
    if (connected) {
      for (const node of nodes) if (!node.connected) this.onEvent?.(node.value, 'Loading', {});
      for (const node of nodes) {
        if (node.connected) continue;
        node.connected = true;
        this.onEvent?.(node.value, 'Loaded', {});
      }
    } else {
      for (let index = nodes.length - 1; index >= 0; index--) {
        const node = nodes[index];
        if (!node.connected) continue;
        node.connected = false;
        this.onEvent?.(node.value, 'Unloaded', {});
      }
    }
  }

  descendants(id) {
    const nodes = [];
    const queue = [id];
    for (let index = 0; index < queue.length; index++) {
      const node = this.require(queue[index]);
      nodes.push(node);
      queue.push(...node.visualChildren);
      if (queue.length > this.maxNodes) throw new ResourceFault('SFTREE001', 'UI tree traversal budget exceeded.');
    }
    return nodes;
  }

  findElementsInHostCoordinates(point, root = null, {includeAllElements = false} = {}) {
    const rectangle = 'width' in point;
    if (![point.x, point.y, ...(rectangle ? [point.width, point.height] : [])].every(Number.isFinite) ||
      rectangle && (point.width < 0 || point.height < 0)) throw new ResourceFault('SFTREE005', 'Host-coordinate geometry must be finite.');
    const matches = [];
    const queue = root === null ? [...this.roots].reverse() : [root];
    let visited = 0;
    while (queue.length) {
      if (++visited > this.maxNodes) throw new ResourceFault('SFTREE001', 'UI tree traversal budget exceeded.');
      const node = this.require(queue.pop());
      if (!includeAllElements && (!node.visible || !node.hitTestVisible)) continue;
      const bounds = node.bounds;
      const intersects = rectangle
        ? point.x + point.width > bounds.x && point.y + point.height > bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height
        : point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.x + bounds.width && point.y < bounds.y + bounds.height;
      if (root === node.id && !intersects) return [];
      if (intersects) matches.push(node.value);
      for (const child of [...node.visualChildren].reverse()) queue.push(child);
    }
    return matches.reverse();
  }

  remove(id) {
    if (!this.nodes.has(id)) return;
    const descendants = this.descendants(id);
    this.setConnected(id, false);
    for (let index = descendants.length - 1; index >= 0; index--) {
      const node = descendants[index];
      if (node.visualParent !== null) this.nodes.get(node.visualParent)?.visualChildren.delete(node.id);
      if (node.logicalParent !== null) this.nodes.get(node.logicalParent)?.logicalChildren.delete(node.id);
      for (const child of node.logicalChildren) if (this.nodes.has(child)) this.setLogicalParent(child, null);
      this.roots.delete(node.id);
      this.nodes.delete(node.id);
    }
  }

  snapshot() {
    return {version: 1, roots: [...this.roots], nodes: [...this.nodes.values()].map(node => ({...node,
      bounds: {...node.bounds}, layoutSize: node.layoutSize && {...node.layoutSize},
      viewport: node.viewport && copyViewportPayload(node.viewport),
      visualChildren: [...node.visualChildren], logicalChildren: [...node.logicalChildren]}))};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1 || snapshot.nodes.length > this.maxNodes) throw new TypeError('Invalid UI tree snapshot.');
    this.roots = new Set(snapshot.roots);
    this.nodes = new Map(snapshot.nodes.map(node => [node.id, {...node, bounds: {...node.bounds},
      layoutSize: node.layoutSize && {...node.layoutSize}, viewport: node.viewport && copyViewportPayload(node.viewport),
      visualChildren: new Set(node.visualChildren), logicalChildren: new Set(node.logicalChildren)}]));
  }

  *retainedValues() {
    for (const root of this.roots) for (const node of this.descendants(root)) yield node.value;
  }

  dispose() {
    for (const root of [...this.roots]) this.remove(root);
    this.nodes.clear();
  }
}
