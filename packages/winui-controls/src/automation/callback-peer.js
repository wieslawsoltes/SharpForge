import { FrameworkElementAutomationPeer, AutomationPeer } from './automation-peer.js';
import { createBuiltInAutomationPeer } from './control-peers.js';
import { providerMembers } from './member-schema.js';

/** Calls actual application overrides; protected base calls use basePeer to avoid redispatch recursion. */
export class CallbackAutomationPeer extends FrameworkElementAutomationPeer {
  constructor(service, owner, receiver, { standalone = false } = {}) {
    super(owner, service.tree, service.tree.definitionFor(owner));
    this.service = service;
    this.receiver = receiver;
    this.standalone = standalone;
    this.boundOwnerId = standalone ? null : owner.id;
    this.basePeer = standalone ? new AutomationPeer(service.tree) : createBuiltInAutomationPeer(owner, service.tree);
    this.customProviders = new Map();
  }
  core(name, args = []) {
    const result = this.service.callVirtual(this.receiver, name, args);
    if (!result.handled) return this.basePeer[name].apply(this, args);
    if (name === 'GetChildrenCore') {
      const values = result.value == null ? [] : this.service.context.items(result.value);
      if (values.length > 20000) throw new RangeError('SFAX016: Custom automation child limit');
      return values.map(value => this.service.unwrapPeer(value));
    }
    if (name === 'GetPatternCore') return this.customPattern(result.value, args[0]);
    if (name === 'GetBoundingRectangleCore') return automationRectangle(this.service.context.native(result.value));
    return this.service.context.native(result.value);
  }
  customPattern(reference, pattern) {
    if (reference == null) return null;
    const model = this.service.unwrap(reference);
    if (model !== reference && !(model instanceof AutomationPeer)) return model;
    const spec = providerMembers[pattern];
    if (!spec) throw new Error('SFAX015: Custom automation pattern is outside the declared provider surface');
    const key = this.service.identity(reference) + ':' + pattern;
    if (!this.customProviders.has(key)) this.customProviders.set(key, createManagedProvider(this.service, reference, pattern));
    return this.customProviders.get(key);
  }
  GetNameCore() { return this.core('GetNameCore'); }
  GetClassNameCore() { return this.core('GetClassNameCore'); }
  GetAutomationIdCore() { return this.core('GetAutomationIdCore'); }
  GetHelpTextCore() { return this.core('GetHelpTextCore'); }
  GetItemStatusCore() { return this.core('GetItemStatusCore'); }
  GetAutomationControlTypeCore() { return this.core('GetAutomationControlTypeCore'); }
  IsEnabledCore() { return this.core('IsEnabledCore'); }
  IsKeyboardFocusableCore() { return this.core('IsKeyboardFocusableCore'); }
  HasKeyboardFocusCore() { return this.core('HasKeyboardFocusCore'); }
  IsOffscreenCore() { return this.core('IsOffscreenCore'); }
  IsPasswordCore() { return this.core('IsPasswordCore'); }
  IsControlElementCore() { return this.core('IsControlElementCore'); }
  IsContentElementCore() { return this.core('IsContentElementCore'); }
  GetBoundingRectangleCore() { return this.core('GetBoundingRectangleCore'); }
  GetChildrenCore() { return this.core('GetChildrenCore'); }
  GetPatternCore(pattern) { return this.core('GetPatternCore', [pattern]); }
  SetFocusCore() { return this.core('SetFocusCore'); }
  dispose() { this.customProviders.clear(); this.basePeer.dispose(); super.dispose(); }
}

export function automationRectangle(value) {
  const data = value?.properties ?? value;
  const result = { x: data?.x ?? data?.X, y: data?.y ?? data?.Y, width: data?.width ?? data?.Width, height: data?.height ?? data?.Height };
  if (!Object.values(result).every(Number.isFinite) || result.width < 0 || result.height < 0) {
    throw new TypeError('SFAX016: Custom peer must return a finite bounding rectangle');
  }
  return result;
}

/** A declared interface projection; arbitrary member names never become managed calls. */
function createManagedProvider(service, reference, pattern) {
  const spec = providerMembers[pattern];
  const result = { managedReference: reference, pattern };
  for (const property of spec.properties) Object.defineProperty(result, property, { enumerable: true, get() {
    const called = service.callVirtual(reference, 'get_' + property, []);
    const value = called.handled ? called.value : service.context.read(reference, property);
    return service.unwrap(value);
  } });
  for (const method of spec.methods) result[method] = (...args) => {
    const called = service.callVirtual(reference, method, args.map(value => service.wrap(value)));
    if (!called.handled) throw new Error('SFAX015: Custom provider does not implement ' + spec.name + '.' + method);
    if (['GetSelection', 'GetChildren', 'GetVisibleRanges'].includes(method) && called.value != null) {
      return service.context.items(called.value).map(value => service.unwrap(value));
    }
    return service.unwrap(called.value);
  };
  return Object.freeze(result);
}
