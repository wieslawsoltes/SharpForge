import { capturePlacement, cloneLayout, createGroup, createSplit, DOCK_SIDES, panelIds, walkLayout } from './nodes.js';
import { emptyLayout, migrateLayout, restorePersistedLayout, validateLayout } from './schema.js';
import { dockNode, floatNode, restorePlacement } from './group-operations.js';
export { createGroup, createSplit, walkLayout } from './nodes.js';

/** Framework-neutral docking model. Mutations are bounded, validated, transactional and undoable. */
export class DockLayout {
  constructor(panels = [], layout = null, { historyLimit = 50, keepEmptyDocuments = true } = {}) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 10000) throw new RangeError('Invalid layout history limit');
    this.panels = new Map();
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = historyLimit;
    this.keepEmptyDocuments = keepEmptyDocuments;
    this.serial = 0;
    this.transactionDepth = 0;
    for (const panel of panels) this.register(panel);
    this.state = layout ? migrateLayout(layout) : emptyLayout(this.panels.keys());
    this.validate(this.state);
  }

  register(panel) {
    if (!panel || typeof panel.id !== 'string' || !panel.id || panel.id.length > 1024 || this.panels.has(panel.id)) {
      throw new Error('Panel identifier must be unique');
    }
    if (this.panels.size >= 8192) throw new Error('Dock panel limit exceeded');
    this.panels.set(panel.id, { title: panel.id, kind: 'tool', closable: true, ...panel });
    if (this.state) {
      this.state.closed.push(panel.id);
      for (const snapshot of [...this.undoStack, ...this.redoStack]) snapshot.closed.push(panel.id);
    }
    return panel.id;
  }

  unregister(id) {
    this.require(id);
    this.change('unregister', () => {
      this.detach(id);
      this.state.closed = this.state.closed.filter(item => item !== id);
      delete this.state.returnLocations[id];
      delete this.state.tabState[id];
      delete this.state.flyoutSizes[id];
      if (this.state.documentViews) delete this.state.documentViews[id];
      if (this.state.panelInstances) delete this.state.panelInstances[id];
      this.panels.delete(id);
      if (this.state.activePanel === id) this.state.activePanel = null;
    });
    this.undoStack = [];
    this.redoStack = [];
  }

  require(id) {
    const panel = this.panels.get(id);
    if (!panel) throw new Error(`Unknown docking panel '${id}'`);
    return panel;
  }

  id(prefix) {
    const ids = new Set();
    this.visit(node => ids.add(node.id));
    for (const floating of this.state.floating) ids.add(floating.id);
    let id;
    do { id = `${prefix}-${++this.serial}`; } while (ids.has(id));
    return id;
  }

  visit(visitor) {
    walkLayout(this.state.root, visitor);
    for (const floating of this.state.floating) walkLayout(floating.root, visitor);
  }

  groups() {
    const result = [];
    this.visit(node => { if (node.type === 'group') result.push(node); });
    return result;
  }

  group(id) { return this.groups().find(group => group.id === id); }
  node(id) {
    let found = null;
    this.visit(node => { if (node.id === id) found = node; });
    return found;
  }

  locate(id) {
    for (const group of this.groups()) {
      const index = group.panels.indexOf(id);
      if (index >= 0) {
        const floating = this.state.floating.find(item => panelIds(item.root).includes(id));
        return { kind: 'group', group, index, floatingId: floating?.id ?? null };
      }
    }
    for (const side of DOCK_SIDES) if (this.state.autoHide[side].includes(id)) return { kind: 'autoHide', side };
    return { kind: 'closed' };
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(type) { for (const listener of this.listeners) listener({ type, layout: this }); }
  snapshot() { return cloneLayout(this.state); }
  serialize() { return JSON.stringify(this.state); }
  validate(state) { return validateLayout(state, this.panels); }

  /** Nested transactions coalesce into one history entry and notification. A failure restores the full state. */
  change(type, action, { history = true } = {}) {
    if (this.transactionDepth) return action();
    const previous = this.snapshot();
    this.transactionDepth++;
    try {
      action();
      this.normalize();
      this.validate(this.state);
    } catch (error) {
      this.state = previous;
      throw error;
    } finally {
      this.transactionDepth--;
    }
    if (JSON.stringify(previous) === this.serialize()) return false;
    if (history) this.recordHistory(previous);
    this.notify(type);
    return true;
  }

  transaction(type, action, options) { return this.change(type, action, options); }
  recordHistory(previous) {
    if (this.historyLimit) this.undoStack.push(previous);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Completes a pointer operation, or restores its initial state on cancellation. */
  finishInteraction(previous, { cancel = false, type = 'interaction' } = {}) {
    this.validate(previous);
    if (cancel) this.state = cloneLayout(previous);
    else if (JSON.stringify(previous) !== this.serialize()) this.recordHistory(previous);
    this.notify(type);
  }

  normalize() {
    const trim = (node, floating = false) => {
      if (node.type === 'group') {
        if (!node.panels.includes(node.active)) node.active = node.panels[0] ?? null;
        if (node.panels.length || !floating && node.kind === 'document' && this.keepEmptyDocuments) return node;
        return null;
      }
      node.first = trim(node.first, floating);
      node.second = trim(node.second, floating);
      return node.first && node.second ? node : node.first ?? node.second;
    };
    this.state.root = trim(this.state.root) ?? createGroup(this.id('documents'), [], 'document');
    this.state.floating = this.state.floating.map(item => ({ ...item, root: trim(item.root, true) })).filter(item => item.root);
    for (const group of this.groups()) {
      group.panels.sort((left, right) => {
        const rank = id => this.state.tabState[id]?.pinned ? 0 : this.state.tabState[id]?.preview ? 2 : 1;
        return rank(left) - rank(right);
      });
    }
  }

  detach(id) {
    for (const group of this.groups()) {
      const index = group.panels.indexOf(id);
      if (index < 0) continue;
      group.panels.splice(index, 1);
      if (group.active === id) group.active = group.panels[Math.min(index, group.panels.length - 1)] ?? null;
    }
    for (const side of DOCK_SIDES) this.state.autoHide[side] = this.state.autoHide[side].filter(item => item !== id);
    this.state.closed = this.state.closed.filter(item => item !== id);
  }

  replaceNode(id, replacement) {
    let replaced = false;
    function replace(node) {
      if (node.id === id) { replaced = true; return replacement; }
      if (node.type === 'split') {
        node.first = replace(node.first);
        node.second = replace(node.second);
      }
      return node;
    }
    this.state.root = replace(this.state.root);
    for (const floating of this.state.floating) floating.root = replace(floating.root);
    if (!replaced) throw new Error('Dock target no longer exists');
  }

  activate(id) {
    this.require(id);
    const where = this.locate(id);
    if (where.kind === 'closed') return this.open(id);
    return this.change('activate', () => {
      if (where.group) where.group.active = id;
      this.state.activePanel = id;
    }, { history: false });
  }

  open(id, target = null, { activate = true } = {}) {
    this.require(id);
    if (!activate) {
      const activePanel = this.state.activePanel;
      const activeGroups = new Map(this.groups().map(group => [group.id, group.active]));
      return this.transaction('openBackground', () => {
        this.open(id, target);
        for (const group of this.groups()) {
          const previous = activeGroups.get(group.id);
          if (previous && group.panels.includes(previous)) group.active = previous;
        }
        this.state.activePanel = activePanel;
      });
    }
    const where = this.locate(id);
    if (where.kind === 'group') return this.activate(id);
    if (!target && this.state.returnLocations[id]) return this.pin(id);
    const group = target ? this.group(target) : this.groups().find(item => item.kind === this.panels.get(id).kind) ?? this.groups()[0];
    if (!group) throw new Error('No docking group');
    return this.dock(id, group.id, 'center');
  }

  close(id) {
    if (!this.require(id).closable) throw new Error('This panel cannot be closed');
    return this.change('close', () => {
      this.state.returnLocations[id] = capturePlacement(this, id);
      this.detach(id);
      this.state.closed.push(id);
      if (this.state.activePanel === id) this.state.activePanel = null;
    });
  }

  dock(id, targetId, side = 'center', index = null) {
    const panel = this.require(id);
    if (!['center', ...DOCK_SIDES].includes(side)) throw new Error('Invalid dock direction');
    const target = this.group(targetId);
    if (!target) throw new Error('Unknown dock group');
    return this.change('dock', () => {
      this.detach(id);
      if (side === 'center') {
        const at = index === null ? target.panels.length : Math.max(0, Math.min(target.panels.length, index));
        target.panels.splice(at, 0, id);
        target.active = id;
      } else {
        const group = createGroup(this.id('group'), [id], panel.kind);
        const first = ['left', 'top'].includes(side);
        const split = createSplit(this.id('split'), ['left', 'right'].includes(side) ? 'horizontal' : 'vertical',
          first ? group : target, first ? target : group, .5);
        this.replaceNode(target.id, split);
      }
      this.state.activePanel = id;
    });
  }

  dockRoot(id, side) {
    this.require(id);
    if (!DOCK_SIDES.includes(side)) throw new Error('Invalid root direction');
    return this.change('dock', () => {
      this.detach(id);
      const group = createGroup(this.id('group'), [id], this.panels.get(id).kind);
      const first = ['left', 'top'].includes(side);
      this.state.root = createSplit(this.id('split'), ['left', 'right'].includes(side) ? 'horizontal' : 'vertical',
        first ? group : this.state.root, first ? this.state.root : group, first ? .23 : .77);
      this.state.activePanel = id;
    });
  }

  float(id, bounds = {}) {
    this.require(id);
    return this.change('float', () => {
      const location = capturePlacement(this, id);
      this.state.returnLocations[id] = location;
      this.detach(id);
      this.state.floating.push({ id: this.id('float'), x: 80, y: 70, width: 640, height: 400, ...bounds,
        returnLocation: location, root: createGroup(this.id('group'), [id], this.require(id).kind) });
      this.state.activePanel = id;
    });
  }

  floatGroup(nodeId, bounds = {}) { return floatNode(this, nodeId, bounds); }
  dockGroup(nodeId, targetId, side = 'center', options = {}) { return dockNode(this, nodeId, targetId, side, options); }

  autoHide(id, side = 'left') {
    if (this.require(id).kind === 'document') throw new Error('Documents cannot auto-hide');
    if (!DOCK_SIDES.includes(side)) throw new Error('Invalid auto-hide side');
    return this.change('autoHide', () => {
      this.state.returnLocations[id] = capturePlacement(this, id);
      this.detach(id);
      this.state.autoHide[side].push(id);
      this.state.activePanel = id;
    });
  }

  autoHideAll(side = 'left') {
    return this.change('autoHideAll', () => {
      const ids = this.groups().flatMap(group => group.panels).filter(id => this.require(id).kind === 'tool');
      const locations = new Map(ids.map(id => [id, capturePlacement(this, id)]));
      for (const id of ids) {
        this.autoHide(id, locations.get(id).side ?? side);
        this.state.returnLocations[id] = locations.get(id);
      }
    });
  }

  pin(id) { this.require(id); return restorePlacement(this, id); }

  setTabState(id, state) {
    if (this.require(id).kind !== 'document') throw new Error('Only documents have tab state');
    return this.change('tabState', () => {
      this.state.tabState[id] = { pinned: false, preview: false, ...this.state.tabState[id], ...state };
    });
  }

  resizeFlyout(id, size, { history = true } = {}) {
    this.require(id);
    return this.change('flyoutSize', () => { this.state.flyoutSizes[id] = Math.max(100, Math.min(20000, size)); }, { history });
  }

  resize(id, ratio, { history = true } = {}) {
    if (!Number.isFinite(ratio)) throw new Error('Invalid split ratio');
    const target = this.node(id);
    if (target?.type !== 'split') throw new Error('Not a split');
    return this.change('resize', () => { target.ratio = Math.max(.05, Math.min(.95, ratio)); }, { history });
  }

  bounds(id, bounds, { history = true } = {}) {
    const floating = this.state.floating.find(item => item.id === id);
    if (!floating) throw new Error('Unknown floating group');
    return this.change('bounds', () => {
      for (const key of ['x', 'y', 'width', 'height']) if (bounds[key] !== undefined) floating[key] = bounds[key];
    }, { history });
  }

  restore(serialized) {
    const next = migrateLayout(serialized);
    this.validate(next);
    return this.change('restore', () => { this.state = next; });
  }

  restorePersisted(serialized, options = {}) {
    const result = restorePersistedLayout(serialized, this.panels, options);
    this.restore(result.state);
    return result.diagnostics;
  }

  undo() {
    if (!this.undoStack.length) return false;
    const next = this.undoStack.at(-1);
    this.validate(next);
    this.undoStack.pop();
    this.redoStack.push(this.snapshot());
    this.state = next;
    this.notify('undo');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    const next = this.redoStack.at(-1);
    this.validate(next);
    this.redoStack.pop();
    this.undoStack.push(this.snapshot());
    this.state = next;
    this.notify('redo');
    return true;
  }
}
