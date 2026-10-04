import { withFamilyTemplate } from './template-renderer.js';
import { controlVisualStates } from './default-templates.js';

/** Per-instance event dispatcher. Subscriptions are idempotently disposable. */
export class ControlEvents {
  #listeners = new Map();
  #removers = new Set();
  #disposed = false;
  #muted = 0;

  on(name, listener, { signal } = {}) {
    if (this.#disposed) throw new Error('Control event source is disposed');
    if (typeof listener !== 'function') throw new TypeError('An event listener is required');
    if (signal?.aborted) return () => {};
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, listeners = new Set());
    listeners.add(listener);
    const remove = () => {
      listeners.delete(listener);
      if (!listeners.size) this.#listeners.delete(name);
      signal?.removeEventListener('abort', remove);
      this.#removers.delete(remove);
    };
    signal?.addEventListener('abort', remove, { once: true });
    this.#removers.add(remove);
    return remove;
  }

  emit(name, args = {}) {
    if (this.#disposed || this.#muted) return args;
    const listeners = this.#listeners.get(name);
    if (listeners) for (const listener of [...listeners]) listener(args);
    return args;
  }

  /** Scene synchronization replays state without emitting a second logical input event. */
  silence(action) {
    this.#muted++;
    try { return action(); } finally { this.#muted--; }
  }

  dispose() {
    this.#disposed = true;
    for (const remove of this.#removers) remove();
    this.#listeners.clear();
  }
}

export class ControlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ControlError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function requireInteger(value, name, { minimum = 0, maximum = 1_000_000 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ControlError('SFUI1601', `${name} is outside its supported range`, { minimum, maximum });
  }
  return value;
}

export function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export const controlName = node => node.type.slice(node.type.lastIndexOf('.') + 1);

/** Node-private state belongs to the host, and is released when the renderer is disposed. */
export function stateFor(context, node, key, create) {
  const state = context.getState(node);
  state.familyStates ??= new Map();
  if (!state.familyStates.has(key)) state.familyStates.set(key, create());
  return state.familyStates.get(key);
}

export function registerFamily(registry, types, renderer) {
  renderer = withFamilyTemplate(renderer);
  registry.register(types, {
    ...renderer,
    render(context, node, element) {
      renderer.render?.(context, node, element);
      context.services.interactions?.update(context, node, element);
      if (context.services.visualStates) {
        const states = controlVisualStates(node.properties);
        const signature = states.join('|');
        const storage = context.getState(node);
        if (signature !== storage.familyVisualStates) {
          storage.familyVisualStates = signature;
          context.services.visualStates.apply(node, states);
        }
      }
    },
    dispose(context, node, element) {
      context.services.interactions?.release(node.id);
      renderer.dispose?.(context, node, element);
      const states = context.getState(node).familyStates;
      if (states) for (const state of states.values()) state?.dispose?.();
      states?.clear();
    }
  }, { override: true });
}

export function emitChange(context, node, event, values = {}) {
  context.emit(node, event, values);
  context.invalidate(node.id);
}

export function setAttribute(element, name, value) {
  if (value === undefined || value === null || value === '') element.removeAttribute(name);
  else element.setAttribute(name, String(value));
}

export function createPart(document, tag, part) {
  const element = document.createElement(tag);
  element.dataset.part = part;
  if (tag === 'button') element.type = 'button';
  return element;
}
