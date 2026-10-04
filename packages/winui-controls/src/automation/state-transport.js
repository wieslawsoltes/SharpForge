import { AutomationPeer } from './automation-peer.js';
import { TextProvider } from './text-provider.js';
import { providerMembers, isAutomationOperation } from './member-schema.js';
import { AutomationControlType, PatternInterface } from './enums.js';

const stringFields = ['Name', 'ClassName', 'AutomationId', 'HelpText', 'ItemStatus'];
const booleanFields = ['IsEnabled', 'IsKeyboardFocusable', 'HasKeyboardFocus', 'IsOffscreen', 'IsPassword', 'IsControlElement', 'IsContentElement'];
const validControlTypes = new Set(Object.values(AutomationControlType));
const scalar = value => value == null || ['string', 'boolean', 'number'].includes(typeof value);

/** Flat, bounded peer values cross the worker boundary; methods and managed heap objects never do. */
export function serializeAutomationPeerState(peer) {
  const state = { version: 1, Suppressed: false, ControlType: peer.GetAutomationControlType(), Patterns: {} };
  for (const property of stringFields) state[property] = peer['Get' + property]();
  for (const property of booleanFields) state[property] = peer[property]();
  state.Children = peer.GetChildren().map(child => child.id);
  for (const [number, spec] of Object.entries(providerMembers)) {
    const pattern = Number(number), provider = peer.GetPattern(pattern);
    if (!provider || state.IsPassword && [PatternInterface.Text, PatternInterface.Value].includes(pattern)) continue;
    const record = { native: !provider.managedReference, properties: {} };
    if (pattern === PatternInterface.Text) {
      if (!(provider instanceof TextProvider)) throw new Error('SFAX018: Remote custom text providers require a native host text adapter');
    } else for (const property of spec.properties) {
      const value = provider[property];
      record.properties[property] = value instanceof AutomationPeer ? { peer: value.id } : value;
    }
    if (!record.native && pattern === PatternInterface.Selection) {
      record.selection = provider.GetSelection().map(value => value instanceof AutomationPeer ? value.id : value?.peer?.id ?? value?.id);
    }
    state.Patterns[number] = record;
  }
  return validateAutomationPeerState(state);
}

function text(value, field) {
  if (typeof value !== 'string' || value.length > 65536) throw new TypeError('SFAX018: Invalid automation ' + field);
  return value;
}
function ids(values, field) {
  if (!Array.isArray(values) || values.length > 20000) throw new TypeError('SFAX018: Invalid automation ' + field);
  return values.map(value => text(value, field));
}
export function validateAutomationPeerState(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype || input.version !== 1 || typeof input.Suppressed !== 'boolean') {
    throw new TypeError('SFAX018: Invalid automation state packet');
  }
  if (input.Suppressed) return Object.freeze({ version: 1, Suppressed: true });
  if (!validControlTypes.has(input.ControlType)) throw new TypeError('SFAX018: Unknown automation control type');
  const result = { version: 1, Suppressed: false, ControlType: input.ControlType, Patterns: {}, Children: ids(input.Children, 'children') };
  for (const property of stringFields) result[property] = text(input[property], property);
  for (const property of booleanFields) {
    if (typeof input[property] !== 'boolean') throw new TypeError('SFAX018: Invalid automation ' + property);
    result[property] = input[property];
  }
  if (!input.Patterns || Object.getPrototypeOf(input.Patterns) !== Object.prototype) throw new TypeError('SFAX018: Missing automation patterns');
  if (Object.keys(input.Patterns).length > Object.keys(providerMembers).length) throw new RangeError('SFAX018: Automation pattern limit');
  for (const [pattern, value] of Object.entries(input.Patterns)) {
    const spec = providerMembers[pattern];
    if (!spec || !value || typeof value.native !== 'boolean') throw new TypeError('SFAX018: Invalid automation pattern');
    const properties = {};
    for (const [property, item] of Object.entries(value.properties ?? {})) {
      if (!spec.properties.includes(property) || !scalar(item) && !(item && Object.keys(item).length === 1 && typeof item.peer === 'string')) {
        throw new TypeError('SFAX018: Invalid provider property');
      }
      if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError('SFAX018: Invalid provider number');
      properties[property] = typeof item === 'string' ? text(item, property) : item?.peer ? Object.freeze({ peer: text(item.peer, property) }) : item;
    }
    if (result.IsPassword && [String(PatternInterface.Value), String(PatternInterface.Text)].includes(pattern)) {
      throw new TypeError('SFAX005: Password automation state cannot contain text/value patterns');
    }
    result.Patterns[pattern] = Object.freeze({ native: value.native, properties: Object.freeze(properties),
      selection: value.selection == null ? null : ids(value.selection, 'selection') });
  }
  Object.freeze(result.Patterns);
  return Object.freeze(result);
}

/** Browser-side remote core values layer onto retained peers without changing scene properties or peer identity. */
export class RemoteAutomationState {
  constructor(tree, invoke) { this.tree = tree; this.invoke = invoke; this.states = new Map(); this.patterns = new Map(); }
  get(id) { return this.states.get(id) ?? null; }
  apply(id, input) {
    if (typeof id !== 'string' || !this.tree.host.nodes.has(id)) return false;
    if (input == null) { this.remove(id); return true; }
    const state = validateAutomationPeerState(input);
    if (this.tree.definitionFor(this.tree.host.nodes.get(id)).password && !state.Suppressed && !state.IsPassword) {
      throw new TypeError('SFAX005: Remote peer cannot remove password protection');
    }
    this.states.set(id, state);
    if (this.tree.peers.get(id) === null) this.tree.peers.delete(id);
    this.tree.names.delete(id);
    this.patterns.delete(id);
    this.tree.host.invalidate?.(id, 'render');
    return true;
  }
  patternFor(peer, pattern) {
    const record = this.states.get(peer.id)?.Patterns?.[pattern];
    if (!record) return null;
    if (record.native) {
      if (!peer.patterns.has(pattern)) peer.patterns.set(pattern, this.tree.createPattern(peer, pattern));
      return peer.patterns.get(pattern);
    }
    let patterns = this.patterns.get(peer.id);
    if (!patterns) { patterns = new Map(); this.patterns.set(peer.id, patterns); }
    if (!patterns.has(pattern)) patterns.set(pattern, this.createProvider(peer, pattern));
    return patterns.get(pattern);
  }
  createProvider(peer, pattern) {
    const spec = providerMembers[pattern], result = { peer };
    for (const property of spec.properties) Object.defineProperty(result, property, { enumerable: true, get: () => {
      const value = this.states.get(peer.id)?.Patterns?.[pattern]?.properties[property];
      return value?.peer ? this.tree.getPeer(value.peer) : value;
    } });
    for (const method of spec.methods) result[method] = (...args) => {
      if (method === 'GetSelection' && pattern === PatternInterface.Selection) {
        return (this.states.get(peer.id)?.Patterns?.[pattern]?.selection ?? []).map(id => this.tree.getPeer(id)).filter(Boolean);
      }
      if (!isAutomationOperation(method, pattern) || !this.invoke) throw new Error('SFAX018: Remote automation action service is unavailable');
      peer.assertAlive();
      return this.invoke(peer.id, method, args, pattern);
    };
    return result;
  }
  remove(id) { this.states.delete(id); this.patterns.delete(id); }
  clear() { this.states.clear(); this.patterns.clear(); }
}

/** Publishes changed custom peers only; equal layout feedback does not create a render/worker loop. */
export class AutomationStatePublisher {
  constructor(service, send) { this.service = service; this.send = send; this.previous = new Map(); this.publishing = false; }
  publishTree() {
    if (this.publishing || this.service.disposed) return;
    this.publishing = true;
    try {
      this.service.sync();
      const alive = new Set();
      for (const node of this.service.tree.host.nodes.values()) {
        const owner = this.service.owner(node.id);
        if (!owner || !this.service.callVirtualExists(owner, 'OnCreateAutomationPeer')) continue;
        alive.add(node.id);
        const peer = this.service.tree.getPeer(node.id);
        this.publish(node.id, peer ? serializeAutomationPeerState(peer) : { version: 1, Suppressed: true });
      }
      for (const id of this.previous.keys()) if (!alive.has(id)) { this.send({ op: 'automationPeer', id, state: null }); this.previous.delete(id); }
    } finally { this.publishing = false; }
  }
  publish(id, state) {
    const value = JSON.stringify(state);
    if (this.previous.get(id) === value) return;
    this.previous.set(id, value);
    this.send({ op: 'automationPeer', id, state });
  }
  snapshot() { return { version: 1, previous: [...this.previous] }; }
  restore(value) {
    if (value?.version !== 1) throw new TypeError('SFAX018: Invalid automation publisher snapshot');
    this.previous = new Map(value.previous);
  }
  dispose() { this.previous.clear(); }
}
