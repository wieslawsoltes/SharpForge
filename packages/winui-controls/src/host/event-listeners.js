import { inputEventTypes } from '../input/input-manager.js';
const captureEvents = new Set(['toggle', 'load', 'error', 'scroll', 'selectionchange', 'focus', 'blur']);

/** Renderer contributions can add event types after host construction without replacing existing subscriptions. */
export function refreshHostEventListeners(host) {
  const types = new Set(['click', 'input', 'change', 'contextmenu', 'toggle', ...inputEventTypes]);
  for (const renderer of host.registry.entries.values()) for (const type of Object.keys(renderer.events ?? {})) types.add(type);
  for (const type of types) {
    if (host.listeners.has(type)) continue;
    const listener = event => { try { host.handleEvent(type, event); } catch (error) { host.options.onError(error); } };
    const capture = captureEvents.has(type);
    host.root.addEventListener(type, listener, { capture, passive: false });
    host.listeners.set(type, { listener, capture });
  }
}
