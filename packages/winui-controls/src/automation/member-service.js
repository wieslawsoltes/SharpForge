import { AutomationPeer } from './automation-peer.js';
import { createBuiltInAutomationPeer } from './control-peers.js';
import { TextRangeProvider } from './text-provider.js';
import { CallbackAutomationPeer } from './callback-peer.js';
import { AutomationModelHandle, AutomationPropertyIdentity, AutomationOwnerPeerLease } from './model-handle.js';
import { peerNamespace, providerNamespace, automationNamespace, providerMembers, peerCoreMethods } from './member-schema.js';

const rawType = providerNamespace + 'IRawElementProviderSimple';
const rangeType = providerNamespace + 'ITextRangeProvider';
const findPeer = model => model instanceof AutomationPeer ? model : model?.peer ?? model?.provider?.peer;

/** One language adapter around the same automation tree used by retained browser semantics. */
export class AutomationMemberService {
  constructor(context, { tree, synchronize, callVirtual, ownsTree = false, publish } = {}) {
    if (!tree) throw new TypeError('SFAX016: An automation tree is required');
    this.context = context;
    this.tree = tree;
    this.synchronize = synchronize ?? (() => {});
    this.invokeVirtual = callVirtual;
    this.ownsTree = ownsTree;
    this.publish = publish;
    this.handles = new WeakMap();
    this.rawHandles = new WeakMap();
    this.identifiers = new Map();
    this.custom = new Map();
    this.disposed = false;
    this.previousFactory = tree.options.tryCreatePeer;
    tree.options.tryCreatePeer = node => this.createCustomPeer(node);
  }
  identity(reference) { return typeof reference === 'string' ? reference : this.context.id(reference); }
  owner(id) {
    if (id == null) return null;
    return this.context.reference?.(id) ?? this.context.objects?.get(id) ?? this.context.services.reference?.(id) ?? null;
  }
  callVirtualExists(receiver, name) {
    if (this.invokeVirtual?.hasOverride) return this.invokeVirtual.hasOverride(receiver, name, 0);
    const framework = new Set([...(this.context.classes?.values() ?? [])].map(Type => Type.prototype));
    for (let proto = receiver; proto && !framework.has(proto); proto = Object.getPrototypeOf(proto)) {
      if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function') return true;
    }
    return !!this.invokeVirtual;
  }
  callVirtual(receiver, name, args) {
    if (this.invokeVirtual) return this.invokeVirtual(receiver, name, args);
    const framework = new Set([...(this.context.classes?.values() ?? [])].map(Type => Type.prototype));
    for (let proto = receiver; proto && !framework.has(proto); proto = Object.getPrototypeOf(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      const callback = descriptor?.value;
      if (typeof callback === 'function') return { handled: true, value: callback.apply(receiver, args) };
      if (name.startsWith('get_')) {
        const getter = Object.getOwnPropertyDescriptor(proto, name.slice(4))?.get;
        if (getter) return { handled: true, value: getter.call(receiver) };
      }
    }
    return { handled: false, value: null };
  }
  sync(owner = null) {
    if (this.disposed) throw new Error('SFAX001: Automation service is disposed');
    this.synchronize(owner);
    this.tree.names.clear();
  }
  unwrap(value) {
    if (value == null) return null;
    const model = this.context.unwrapModel(value);
    return model instanceof AutomationModelHandle ? model.model : model;
  }
  unwrapPeer(value) {
    const model = this.unwrap(value);
    if (!(model instanceof AutomationPeer) || model.tree !== this.tree) throw new TypeError('SFAX016: A peer from this UI root is required');
    return model;
  }
  referenceFor(model) { return this.context.modelReferences?.get(model) ?? this.context.modelReferences?.get(this.handles.get(model)); }
  wrap(model, expectedType = null) {
    if (model == null) return null;
    if (model.managedReference) return model.managedReference;
    if (Array.isArray(model)) {
      const elementType = expectedType?.endsWith('[]') ? expectedType.slice(0, -2) : null;
      return this.context.array(model.map(value => this.wrap(value, elementType)), elementType ?? 'object');
    }
    if (model instanceof AutomationPeer) return this.wrapPeer(model, expectedType === rawType);
    if (model instanceof TextRangeProvider) return this.wrapHandle(model, 'range', rangeType);
    if (model instanceof AutomationPropertyIdentity) return this.wrapHandle(model, 'property', automationNamespace + 'AutomationProperty');
    if (model?.peer instanceof AutomationPeer) {
      const entry = Object.entries(providerMembers).find(([pattern]) => model.peer.GetPattern(Number(pattern)) === model);
      if (!entry) throw new TypeError('SFAX015: Automation provider is not registered on its peer');
      return this.wrapHandle(model, 'pattern', providerNamespace + entry[1].name);
    }
    if (expectedType === 'Windows.Foundation.Rect') return this.context.managed({ valueType: expectedType,
      X: model.x ?? model.X, Y: model.y ?? model.Y, Width: model.width ?? model.Width, Height: model.height ?? model.Height }, expectedType);
    return this.context.managed(model, expectedType);
  }
  wrapPeer(peer, raw = false) {
    if (raw) {
      let handle = this.rawHandles.get(peer);
      if (!handle) { handle = new AutomationModelHandle(this, peer, 'raw', this.owner(peer.ownerId ?? peer.id)); this.rawHandles.set(peer, handle); }
      return this.context.wrapModel(handle, rawType);
    }
    const previous = this.referenceFor(peer);
    if (previous && (this.context.isAlive?.(previous) ?? true)) return previous;
    const name = peer instanceof CallbackAutomationPeer ? this.context.typeOf(peer.receiver) : peerNamespace + peer.constructor.name;
    const registered = this.context.frameworkRegistry?.types?.has(name);
    return this.wrapHandle(peer, 'peer', registered ? name : peerNamespace + 'FrameworkElementAutomationPeer');
  }
  wrapHandle(model, kind, type) {
    let handle = this.handles.get(model);
    if (!handle) {
      handle = new AutomationModelHandle(this, model, kind, this.owner(findPeer(model)?.ownerId ?? findPeer(model)?.id));
      this.handles.set(model, handle);
    }
    const reference = this.context.wrapModel(handle, type);
    this.context.modelReferences?.set(model, reference);
    return reference;
  }
  isElementPeer(receiver) {
    const seen = new Set();
    let type = this.context.typeOf(receiver);
    while (type && !seen.has(type) && seen.size < 256) {
      if (type === peerNamespace + 'FrameworkElementAutomationPeer') return true;
      seen.add(type);
      type = this.context.baseType?.(type) ?? this.context.frameworkRegistry?.frameworkType(type)?.base;
    }
    return false;
  }
  initializePeer(receiver, ownerType, args = []) {
    if (!ownerType.startsWith(peerNamespace) || !ownerType.endsWith('AutomationPeer')) return false;
    const standalone = ownerType === peerNamespace + 'AutomationPeer' && args.length === 0;
    // Direct CIL visits the parameterless base before the derived owner-taking constructor.
    if (standalone && this.isElementPeer(receiver)) return true;
    if (!standalone && (args.length !== 1 || args[0] == null)) {
      throw new TypeError('SFAX016: Framework automation peers require one element owner');
    }
    const owner = standalone ? null : args[0];
    if (owner) this.sync(owner);
    const id = owner ? this.identity(owner) : 'automation:' + this.identity(receiver);
    const node = standalone ? { id, type: peerNamespace + 'AutomationPeer', properties: {}, collections: {} } : this.tree.host.nodes.get(id);
    if (!node) throw new TypeError('SFAX016: Automation owner is not a UI element');
    const existing = this.context.state(receiver, 'nativeModel');
    if (existing) {
      if (!(existing instanceof AutomationModelHandle) || existing.model.id !== id) throw new TypeError('SFAX016: Peer owner cannot change');
      return true;
    }
    const model = new CallbackAutomationPeer(this, node, receiver, { standalone });
    const handle = new AutomationModelHandle(this, model, 'peer', owner);
    this.handles.set(model, handle);
    this.context.state(receiver, 'nativeModel', () => handle);
    this.context.modelReferences?.set(model, receiver);
    this.context.modelReferences?.set(handle, receiver);
    return true;
  }
  constructPeer(type, args) {
    const reference = this.context.allocate(type);
    this.initializePeer(reference, type, args);
    return reference;
  }
  createCustomPeer(node) {
    const owner = this.owner(node.id);
    if (owner == null) return this.previousFactory?.(node) ?? { handled: false };
    const result = this.callVirtual(owner, 'OnCreateAutomationPeer', []);
    if (!result.handled) return this.previousFactory?.(node) ?? { handled: false };
    if (result.value == null) return { handled: true, value: null };
    const peer = this.unwrapPeer(result.value);
    if (peer.standalone && peer.boundOwnerId == null) {
      peer.id = node.id; peer.boundOwnerId = node.id;
      const handle = this.context.state(result.value, 'nativeModel');
      handle.owner = owner; this.context.syncOwner?.(result.value);
    }
    if (peer.id !== node.id) throw new TypeError('SFAX016: OnCreateAutomationPeer returned a peer for a different element');
    this.custom.set(node.id, result.value);
    return { handled: true, value: peer };
  }
  peerFor(owner, existingOnly = false) {
    this.sync(owner);
    const id = this.identity(owner);
    const node = this.tree.host.nodes.get(id);
    if (!node) return null;
    const custom = this.callVirtualExists(owner, 'OnCreateAutomationPeer');
    if (!custom && this.tree.definitionFor(node).publicFactory === false) return null;
    const peer = existingOnly ? this.tree.peers.get(id) ?? null : this.tree.getPeer(id);
    if (!peer) return null;
    const reference = this.wrapPeer(peer);
    const lease = this.context.state(owner, 'automation.peer', () => new AutomationOwnerPeerLease(reference));
    lease.reference = reference;
    this.context.syncOwner?.(owner);
    this.publish?.(peer);
    return reference;
  }
  wrapPeerOrNull(peer) { return peer == null ? null : this.wrapPeer(peer); }
  baseCreatePeer(owner) {
    this.sync(owner);
    const node = this.tree.host.nodes.get(this.identity(owner));
    return node ? this.wrapPeer(createBuiltInAutomationPeer(node, this.tree)) : null;
  }
  propertyIdentity(group, property) {
    const name = group === 'AutomationElementIdentifiers' ? property : group.replace('Identifiers', '') + '.' + property;
    if (!this.identifiers.has(name)) this.identifiers.set(name, new AutomationPropertyIdentity(name));
    return this.wrap(this.identifiers.get(name));
  }
  member(receiver, descriptor, args = []) {
    const target = this.unwrap(receiver);
    const peer = findPeer(target);
    if (!target || !peer && !(target instanceof AutomationPropertyIdentity)) throw new TypeError('SFAX016: Invalid automation receiver');
    if (peer) {
      if (!peer.standalone || peer.boundOwnerId != null) this.sync(this.owner(peer.ownerId ?? peer.id));
      peer.assertAlive();
    }
    const name = descriptor.property ?? descriptor.name.replace(/^(get|set)_/, '');
    if (descriptor.kind === 'get') {
      if (name === 'Owner') return this.owner(peer.ownerId ?? peer.id);
      return this.wrap(target[name], descriptor.result);
    }
    if (descriptor.kind === 'set') {
      if (name !== 'EventsSource') throw new TypeError('SFAX015: Automation property is read-only');
      target.EventsSource = args[0] == null ? null : this.unwrapPeer(args[0]);
      this.context.syncOwner?.(receiver);
      return null;
    }
    const native = args.map(value => this.unwrap(value));
    if (name === 'RangeFromPoint') native[0] = { x: native[0]?.x ?? native[0]?.X, y: native[0]?.y ?? native[0]?.Y };
    const base = peerCoreMethods.includes(name) && target.basePeer ? target.basePeer : target;
    if (typeof base[name] !== 'function') throw new TypeError('SFAX015: Unsupported automation member ' + name);
    const result = base[name].apply(target, native);
    if (peer && !name.endsWith('Core')) this.publish?.(peer);
    return this.wrap(result, descriptor.result);
  }
  releaseHandle(handle) {
    const peer = findPeer(handle.model);
    if (peer instanceof CallbackAutomationPeer && this.custom.get(peer.id) === this.referenceFor(peer)) this.custom.delete(peer.id);
    this.handles.delete(handle.model);
  }
  *retainedValues() {
    const reachable = new Set();
    const visit = id => {
      if (reachable.has(id) || reachable.size >= 20000) return;
      reachable.add(id);
      const node = this.tree.host.nodes.get(id);
      for (const child of node ? this.tree.host.visualChildren(node) : []) visit(child);
    };
    for (const root of this.tree.host.windows) visit(root);
    for (const [id, reference] of this.custom) if (reachable.has(id)) yield reference;
  }
  snapshot() { return { version: 1, custom: [...this.custom], publisher: this.publisher?.snapshot() }; }
  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('SFAX016: Invalid automation service snapshot');
    this.custom = new Map(snapshot.custom);
    if (snapshot.publisher) this.publisher?.restore(snapshot.publisher);
    this.tree.names.clear();
    for (const [id, reference] of this.custom) this.tree.peers.set(id, this.unwrapPeer(reference));
  }
  dispose() {
    if (this.disposed) return;
    this.custom.clear();
    this.publisher?.dispose();
    this.identifiers.clear();
    this.tree.options.tryCreatePeer = this.previousFactory;
    if (this.ownsTree) this.tree.dispose();
    this.disposed = true;
  }
}

export function createAutomationMemberServices(context, options = {}) {
  return context.state(null, 'automationService', () => new AutomationMemberService(context,
    { tree: options.tree ?? context.host?.automation, ...options }));
}
