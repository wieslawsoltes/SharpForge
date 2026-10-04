import { AutomationPeer, nameFromNode } from './automation-peer.js';
import { createBuiltInAutomationPeer, builtInPeerDefinition, registerAutomationAdapters } from './control-peers.js';
import { AriaBridge, automationRole } from './aria-bridge.js';
import { AutomationEventQueue, AutomationLiveRegions } from './automation-events.js';
import { SemanticProxyTree } from './semantic-proxy.js';
import { createAutomationPattern } from './patterns.js';
import { AutomationEvents, enumName, PatternInterface } from './enums.js';
import { isAutomationOperation } from './member-schema.js';
import { VirtualItemAutomationPeer } from './virtual-item-peer.js';
import { visibleAutomationGeometry } from './visibility.js';
import { RemoteAutomationState } from './state-transport.js';

/** One retained automation tree is shared by DOM, GPU and programmatic peer calls. */
export class AutomationTree {
  constructor(host, options = {}) {
    this.host = host;
    this.options = options;
    this.peers = new Map();
    this.peerClasses = new Map();
    this.itemPeers = new Map();
    this.definitions = new Map();
    this.names = new Map();
    this.previous = new Map();
    this.disposed = false;
    this.version = 0;
    this.creating = new Set();
    this.remote = new RemoteAutomationState(this, options.onAction ?? host.options?.onAutomationAction);
    this.bridge = new AriaBridge(this);
    this.liveRegions = host.document ? new AutomationLiveRegions(host.document) : null;
    this.events = new AutomationEventQueue({ onEvent: options.onEvent ?? host.options?.onAutomationEvent,
      onError: options.onError ?? host.options?.onError, liveRegions: this.liveRegions, schedule: options.schedule });
    this.proxies = host.document ? new SemanticProxyTree(this) : null;
    this.layers = [this.proxies?.layer, this.liveRegions?.layer].filter(Boolean);
    if (host.registry) registerAutomationAdapters(host.registry);
  }
  definitionFor(node) {
    if (!node) return {};
    const descriptor = this.host.registry?.resolve(node.type);
    return descriptor?.automation ?? builtInPeerDefinition(node.frameworkType ?? node.type, this.host.frameworkType);
  }
  getPeer(id) {
    if (!id || this.disposed) return null;
    if (this.remote.get(id)?.Suppressed) return null;
    if (this.itemPeers.has(id)) return this.itemPeers.get(id);
    const node = this.host.nodes.get(id);
    if (!node) return null;
    if (this.peers.has(id)) return this.peers.get(id);
    if (this.creating.has(id)) throw new Error('SFAX014: OnCreateAutomationPeer recursively requested its own peer');
    this.creating.add(id);
    try {
      const custom = this.options.createPeer ?? this.host.services?.createAutomationPeer;
      const descriptor = this.host.registry?.resolve(node.type);
      const override = this.options.tryCreatePeer?.(node, this);
      const peer = override?.handled ? override.value : custom?.(node, this)
        ?? descriptor?.createAutomationPeer?.(this.host.context, node, this) ?? createBuiltInAutomationPeer(node, this);
      if (peer === null && override?.handled) { this.peers.set(id, null); this.definitions.set(id, node.type); return null; }
      if (!(peer instanceof AutomationPeer)) throw new TypeError('SFAX014: OnCreateAutomationPeer must return an AutomationPeer');
      peer.tree = this;
      peer.id = id;
      peer.definition ??= this.definitionFor(node);
      this.peers.set(id, peer);
      this.definitions.set(id, node.type);
      return peer;
    } finally { this.creating.delete(id); }
  }
  childrenOf(id) {
    const node = this.host.nodes.get(id);
    if (!node) return [];
    const parent = this.peers.get(id);
    const items = parent && this.realizedItems(parent);
    if (items?.length) return items.map(item => this.itemPeer(parent, item.index));
    const result = [], pending = [...this.host.visualChildren(node)].reverse(), seen = new Set([id]);
    while (pending.length) {
      const child = pending.pop();
      if (seen.has(child)) continue;
      if (seen.size >= 20000) throw new RangeError('SFAX013: Automation child traversal limit');
      seen.add(child);
      const peer = this.getPeer(child);
      if (peer) result.push(peer);
      else { const owner = this.host.nodes.get(child); if (owner) pending.push(...this.host.visualChildren(owner).reverse()); }
    }
    return result;
  }
  nameOf(id) {
    if (!this.names.has(id)) this.names.set(id, nameFromNode(this, id));
    return this.names.get(id);
  }
  ancestorState(id, predicate) {
    const visited = new Set();
    while (id) {
      if (visited.has(id) || visited.size >= 512) return false;
      visited.add(id);
      const node = this.host.nodes.get(id);
      if (!node || !predicate(node)) return false;
      id = this.host.parentOf(id);
    }
    return true;
  }
  isHidden(id) {
    return !this.ancestorState(id, node => ![1, 'Collapsed'].includes(node.properties.Visibility) && node.properties.Visible !== false && node.properties.IsOpen !== false);
  }
  isVisible(id) {
    const layout = this.host.getLayout(id);
    const root = this.host.root;
    const viewport = root ? { x: 0, y: 0, width: root.clientWidth, height: root.clientHeight } : null;
    return !this.isHidden(id) && visibleAutomationGeometry(layout, viewport);
  }
  realizedItems(peer) { return this.modelFor(peer, 'getAutomationItems') ?? []; }
  itemPeer(parent, index) {
    const model = this.modelFor(parent, 'getSelectionModel');
    if (!Number.isInteger(index) || index < 0 || index >= (model?.count ?? 0)) return null;
    const key = model.keyAt(index), id = parent.id + '::item:' + String(key);
    if (!this.itemPeers.has(id)) {
      if (this.itemPeers.size >= (this.options.maximumItemPeers ?? 20000)) throw new RangeError('SFAX013: Automation item peer limit');
      this.itemPeers.set(id, new VirtualItemAutomationPeer(parent, key));
    }
    return this.itemPeers.get(id);
  }
  createPattern(peer, pattern) { return createAutomationPattern(peer, pattern); }
  modelFor(peer, name) {
    const descriptor = this.host.registry?.resolve(peer.Owner?.type);
    return descriptor?.[name]?.(this.host.context, peer.Owner) ?? this.host.services?.[name]?.(peer.Owner);
  }
  invalidate() { this.names.clear(); this.host.invalidate?.(null, 'render'); }
  update(world = this.host.worldLayout, handled = new Set()) {
    if (this.disposed) return;
    this.names.clear();
    this.proxies?.begin();
    for (const [id, layout] of world) {
      const node = this.host.nodes.get(id);
      if (!node) continue;
      if (this.definitions.has(id) && this.definitions.get(id) !== node.type) this.remove(id);
      const peer = this.getPeer(id);
      if (!peer) {
        const element = this.host.elements?.get(id);
        if (element) this.bridge.assign(element, { role: 'presentation' });
        continue;
      }
      const element = this.host.elements?.get(id);
      const descriptor = this.host.registry?.resolve(node.type);
      const proxy = handled.has(id) && (descriptor?.automationProxy || this.host.services?.requiresAutomationProxy?.(node, element, layout));
      if (!proxy || !this.proxies?.update(peer, layout, element)) this.bridge.apply(peer, element);
      for (const item of this.realizedItems(peer)) this.itemPeer(peer, item.index);
      this.recordChanges(peer);
    }
    for (const id of this.peers.keys()) if (!this.host.nodes.has(id)) this.remove(id);
    for (const [id, peer] of this.itemPeers) {
      if (!this.host.nodes.has(peer.parent.id) || peer.index < 0) { peer.dispose(); this.itemPeers.delete(id); }
      else if (peer.realized?.element) { this.bridge.apply(peer, peer.realized.element); this.recordChanges(peer); }
    }
    this.proxies?.end();
    this.version++;
  }
  recordChanges(peer) {
    const state = { Name: peer.GetName(), IsEnabled: peer.IsEnabled(), HasKeyboardFocus: peer.HasKeyboardFocus(),
      IsOffscreen: peer.IsOffscreen() };
    for (const [pattern, properties] of [[PatternInterface.Toggle, ['ToggleState']], [PatternInterface.Value, ['Value', 'IsReadOnly']],
      [PatternInterface.RangeValue, ['Value', 'Minimum', 'Maximum']], [PatternInterface.SelectionItem, ['IsSelected']],
      [PatternInterface.ExpandCollapse, ['ExpandCollapseState']]]) {
      const provider = peer.GetPattern(pattern);
      if (provider) for (const property of properties) state[enumName(PatternInterface, pattern) + '.' + property] = provider[property];
    }
    const previous = this.previous.get(peer.id);
    if (previous) for (const property of Object.keys(state)) {
      if (previous[property] === state[property]) continue;
      this.events.propertyChanged(peer, property, previous[property], state[property]);
      if (property === 'HasKeyboardFocus' && state[property]) this.events.raise(peer, AutomationEvents.AutomationFocusChanged);
    }
    this.previous.set(peer.id, state);
  }
  snapshot({ includeRaw = false } = {}) {
    this.names.clear();
    const visited = new Set();
    const visit = (id, depth = 0) => {
      if (visited.has(id) || depth > 512) throw new Error('SFAX014: Automation tree cycle/depth limit');
      visited.add(id);
      const peer = this.getPeer(id);
      if (!peer) {
        const node = this.host.nodes.get(id);
        return node ? this.host.visualChildren(node).flatMap(child => visit(child, depth + 1)) : [];
      }
      const children = peer.GetChildren().flatMap(child => visit(child.id, depth + 1));
      if (!includeRaw && !peer.IsControlElement()) return children;
      return [{ id, name: peer.GetName(), automationId: peer.GetAutomationId(), className: peer.GetClassName(),
        controlType: peer.GetAutomationControlType(), role: automationRole(peer), enabled: peer.IsEnabled(),
        focusable: peer.IsKeyboardFocusable(), focused: peer.HasKeyboardFocus(), offscreen: peer.IsOffscreen(),
        password: peer.IsPassword(), bounds: { ...peer.GetBoundingRectangle() },
        patterns: Object.entries(PatternInterface).filter(([, value]) => peer.GetPattern(value)).map(([name]) => name), children }];
    };
    return { version: 1, roots: (this.host.visualRoots?.() ?? this.host.windows).flatMap(id => visit(id)) };
  }
  invoke(id, method, args = [], pattern = null) {
    const peer = this.getPeer(id);
    if (!peer) throw new Error('SFAX014: Automation target is not in the host');
    const target = pattern == null ? peer : peer.GetPattern(pattern);
    const callback = target?.[method];
    if (!isAutomationOperation(method, pattern) || typeof callback !== 'function') {
      throw new Error('SFAX015: Unsupported automation operation: ' + (enumName(PatternInterface, pattern) ?? 'Peer') + '.' + method);
    }
    return callback.apply(target, args);
  }
  remove(id) {
    for (const [key, peer] of this.itemPeers) if (peer.parent.id === id || key === id) {
      peer.dispose(); this.itemPeers.delete(key); this.previous.delete(key); this.events.remove(key);
    }
    this.peers.get(id)?.dispose();
    this.peers.delete(id);
    this.definitions.delete(id);
    this.names.delete(id);
    this.previous.delete(id);
    this.events.remove(id);
    this.remote.remove(id);
    this.proxies?.remove(id);
  }
  dispose() {
    if (this.disposed) return;
    for (const id of this.peers.keys()) this.remove(id);
    this.events.dispose();
    this.proxies?.dispose();
    this.liveRegions?.dispose();
    this.bridge.dispose();
    this.peerClasses.clear();
    this.disposed = true;
  }
}
