import { controlVisualStates } from '../policy/default-templates.js';

const allowed = new Set(['IsPointerOver', 'IsPressed', 'FocusState']);

/** Native feedback contains only bounded, read-only interaction state, never arbitrary property writes. */
export function validateControlStateChanges(changes) {
  if (!Array.isArray(changes) || changes.length > 256) throw new RangeError('SFUI1674: Control state batch limit');
  return changes.map(change => {
    if (!change || ![Object.prototype, null].includes(Object.getPrototypeOf(change))
      || Object.values(Object.getOwnPropertyDescriptors(change)).some(value => !Object.hasOwn(value, 'value'))) {
      throw new TypeError('SFUI1674: Invalid control state record');
    }
    if (!change || typeof change.id !== 'string' || !change.id || change.id.length > 512 || !change.properties
      || ![Object.prototype, null].includes(Object.getPrototypeOf(change.properties))) throw new TypeError('SFUI1674: Invalid control state change');
    const properties = {};
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(change.properties))) {
      if (!allowed.has(name) || !Object.hasOwn(descriptor, 'value')) throw new TypeError('SFUI1674: Invalid control state field');
      const value = descriptor.value;
      if (name === 'FocusState' ? !Number.isInteger(value) || value < 0 || value > 3 : typeof value !== 'boolean') {
        throw new TypeError('SFUI1674: Invalid control state value');
      }
      properties[name] = value;
    }
    return { id: change.id, properties };
  });
}

/** A root owns hover/press counts and focus state; multiple pointers cannot clear another pointer's active press. */
export class InputVisualStateTracker {
  constructor(host) {
    this.host = host;
    this.hover = new Map();
    this.presses = new Map();
    this.keyboardPress = new Set();
    this.pending = new Map();
  }
  route(id) {
    const result = new Set();
    const visited = new Set();
    let current = id;
    while (current != null) {
      if (visited.has(current) || visited.size >= 512) throw new RangeError('SFUI1605: Visual state ancestry limit');
      visited.add(current);
      result.add(current);
      const node = this.host.nodes.get(current);
      if (node?.templateOwner) result.add(node.templateOwner);
      current = this.host.parentOf?.(current) ?? this.host.layoutEngine?.states.get(current)?.parent;
    }
    return result;
  }
  set(id, property, value) {
    const node = this.host.nodes.get(id);
    if (!node || node.properties[property] === value) return;
    node.properties[property] = value;
    if (!this.pending.has(id)) this.pending.set(id, {});
    this.pending.get(id)[property] = value;
  }
  refresh(ids) {
    const hovering = new Set(), pressing = new Set(this.keyboardPress), enabled = new Map();
    for (const route of this.hover.values()) for (const id of route) hovering.add(id);
    for (const route of this.presses.values()) for (const id of route) if (hovering.has(id)) pressing.add(id);
    for (const id of ids) {
      this.set(id, 'IsPointerOver', hovering.has(id));
      this.set(id, 'IsPressed', pressing.has(id) && this.isEnabled(id, enabled));
    }
  }
  isEnabled(id, cache = new Map(), visiting = new Set()) {
    if (id == null) return true;
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id) || visiting.size >= 512) throw new RangeError('SFUI1605: Visual state ancestry limit');
    visiting.add(id);
    const node = this.host.nodes.get(id), properties = node?.properties;
    const parent = this.host.parentOf?.(id) ?? this.host.layoutEngine?.states.get(id)?.parent;
    const enabled = !!properties && properties.IsEnabled !== false && properties.IsEnabled !== 0 && properties.Visibility !== 1
      && properties.Visibility !== 'Collapsed' && properties.Visible !== false && this.isEnabled(parent, cache, visiting)
      && (node.templateOwner == null || node.templateOwner === parent || this.isEnabled(node.templateOwner, cache, visiting));
    visiting.delete(id);
    cache.set(id, enabled);
    return enabled;
  }
  propertyChanged(id, property) {
    if (!['IsEnabled', 'Visibility', 'Visible'].includes(property)) return;
    const affected = new Set([id, ...this.keyboardPress]);
    for (const route of this.presses.values()) for (const current of route) affected.add(current);
    for (const current of this.keyboardPress) if (!this.isEnabled(current)) this.keyboardPress.delete(current);
    this.refresh(affected);
    this.flush();
  }
  pointer(type, id, event) {
    const pointer = event.pointerId ?? 1;
    const previous = this.hover.get(pointer) ?? new Set();
    let next = previous;
    if (!this.hover.has(pointer) && this.hover.size >= 256) throw new RangeError('SFUI1674: Visual state pointer limit');
    if (['pointerdown', 'pointermove', 'pointerover'].includes(type)) next = this.route(id);
    else if (type === 'pointerout') {
      const related = this.host.root.contains(event.relatedTarget) ? event.relatedTarget?.closest?.('[data-sf-id]')?.dataset.sfId : null;
      next = this.route(related);
    }
    if ((['pointerup', 'pointercancel'].includes(type) && event.pointerType === 'touch') || type === 'pointercancel') next = new Set();
    if (next.size) this.hover.set(pointer, next); else this.hover.delete(pointer);
    const pressed = this.presses.get(pointer) ?? new Set();
    if (type === 'pointerdown' && (event.button ?? 0) === 0) this.presses.set(pointer, this.route(id));
    if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(type)) this.presses.delete(pointer);
    this.refresh(new Set([...previous, ...next, ...pressed]));
    this.flush();
  }
  keyboard(type, id, event) {
    if (![' ', 'Enter'].includes(event.key) || event.isComposing) return;
    const route = this.route(id);
    if (type === 'keydown' && !event.repeat) for (const current of route) this.keyboardPress.add(current);
    if (type === 'keyup') for (const current of [...this.keyboardPress]) { route.add(current); this.keyboardPress.delete(current); }
    this.refresh(route);
    this.flush();
  }
  focus(previous, next, state) {
    if (previous != null && previous !== next) this.set(previous, 'FocusState', 0);
    if (next != null) this.set(next, 'FocusState', state);
    if (previous !== next && this.keyboardPress.size) {
      const ids = [...this.keyboardPress];
      this.keyboardPress.clear();
      this.refresh(ids);
    }
    this.flush();
  }
  flush() {
    const changes = [...this.pending].map(([id, properties]) => ({ id, properties }));
    this.pending.clear();
    for (let start = 0; start < changes.length; start += 256) this.host.options.onControlStateChanged?.(changes.slice(start, start + 256));
    for (const { id } of changes) {
      const node = this.host.nodes.get(id);
      if (!node) continue;
      const states = controlVisualStates(node.properties);
      this.host.services.visualStates?.apply(node, states);
      this.host.context.getState(node).familyVisualStates = states.join('|');
      this.host.invalidate(id, 'render');
    }
  }
  removeNode(id) {
    const affected = new Set();
    for (const collection of [this.hover, this.presses]) for (const [pointer, route] of collection) {
      if (!route.has(id)) continue;
      for (const current of route) if (current !== id) affected.add(current);
      collection.delete(pointer);
    }
    this.keyboardPress.delete(id);
    this.pending.delete(id);
    this.refresh(affected);
    this.flush();
  }
  dispose() { this.hover.clear(); this.presses.clear(); this.keyboardPress.clear(); this.pending.clear(); }
}
