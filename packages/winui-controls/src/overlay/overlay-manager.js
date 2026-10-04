import { ControlEvents, ControlError } from '../policy/events.js';
import { dispatchDeferred } from './deferrals.js';
import { placeOverlay } from './placement.js';

const focusable = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]';

/** A portal manager scoped to one XamlRoot, with focus restoration and stacked dismissal. */
export class OverlayManager extends ControlEvents {
  constructor({ root, timeout = 5000 } = {}) {
    super();
    if (!root?.ownerDocument) throw new TypeError('OverlayManager requires a DOM root');
    this.root = root;
    this.document = root.ownerDocument;
    this.timeout = timeout;
    this.layer = this.document.createElement('div');
    this.layer.dataset.sfOverlayLayer = '';
    Object.assign(this.layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1000' });
    root.append(this.layer);
    this.entries = [];
    this.key = event => this.keydown(event);
    this.pointer = event => this.pointerdown(event);
    root.addEventListener('keydown', this.key);
    root.addEventListener('pointerdown', this.pointer, true);
  }

  show(content, { id = content, anchor = null, modal = false, lightDismiss = true, placement = 'Bottom', offsets = {},
    constrain = true, focus = true, events = new ControlEvents() } = {}) {
    if (this.entries.some(entry => entry.id === id)) throw new ControlError('SFUI1663', 'Overlay is already open');
    if (modal && this.entries.some(entry => entry.modal)) throw new ControlError('SFUI1664', 'Only one modal dialog may be active in a XamlRoot');
    const opening = events.emit('Opening', { Cancel: false });
    if (opening.Cancel) return null;
    const wrapper = this.document.createElement('div');
    wrapper.dataset.overlay = 'true';
    wrapper.style.pointerEvents = 'auto';
    wrapper.append(content);
    const entry = { id, content, wrapper, anchor, modal, lightDismiss, placement, offsets, constrain, events,
      previousFocus: this.document.activeElement, closing: false, controller: new AbortController() };
    entry.result = new Promise(resolve => { entry.resolve = resolve; });
    this.layer.append(wrapper);
    this.entries.push(entry);
    content.hidden = false;
    if (modal) {
      Object.assign(wrapper.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center',
        background: 'rgb(0 0 0 / 35%)' });
      content.setAttribute('role', 'dialog');
      content.setAttribute('aria-modal', 'true');
    } else this.position(entry);
    if (focus) (content.querySelector(focusable) ?? content).focus?.();
    events.emit('Opened', {});
    return entry;
  }

  position(entry) {
    const rect = entry.anchor?.getBoundingClientRect() ?? this.root.getBoundingClientRect();
    const root = this.root.getBoundingClientRect();
    const { left, top, placement } = placeOverlay({ root, anchor: rect, size: { width: entry.content.offsetWidth, height: entry.content.offsetHeight },
      placement: entry.placement, offsets: entry.offsets, constrain: entry.constrain });
    entry.resolvedPlacement = placement;
    Object.assign(entry.wrapper.style, { position: 'absolute', left: left + 'px', top: top + 'px' });
  }

  async close(entry = this.entries.at(-1), { reason = 'programmatic', result = 0, signal } = {}) {
    if (!entry || !this.entries.includes(entry) || entry.closing) return false;
    entry.closing = true;
    const abort = () => entry.controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const args = await dispatchDeferred(entry.events, 'Closing', { Reason: reason, Result: result },
        { timeout: this.timeout, signal: entry.controller.signal });
      if (args.Cancel) return false;
      if (!this.dismiss(entry, { result, reason })) return false;
      if (this.root.contains(entry.previousFocus)) entry.previousFocus.focus?.();
      return true;
    } finally { signal?.removeEventListener('abort', abort); entry.closing = false; }
  }

  dismiss(entry, { result = 0, reason = 'unloaded' } = {}) {
    const index = this.entries.indexOf(entry);
    if (index < 0) return false;
    this.entries.splice(index, 1);
    entry.controller.abort();
    entry.wrapper.remove(); entry.content.hidden = true; entry.resolve(result);
    entry.events.emit('Closed', { Reason: reason, Result: result });
    return true;
  }

  pointerdown(event) {
    const entry = this.entries.at(-1);
    if (entry?.lightDismiss && !entry.content.contains(event.target) && !entry.anchor?.contains(event.target)) {
      this.close(entry, { reason: 'light-dismiss' }).catch(error => this.emit('Error', { error }));
    }
  }

  keydown(event) {
    const entry = this.entries.at(-1);
    if (!entry) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(entry, { reason: 'escape' }).catch(error => this.emit('Error', { error }));
    } else if (event.key === 'Tab' && entry.modal) {
      const candidates = [...entry.content.querySelectorAll(focusable)].filter(element => element.tabIndex >= 0 && !element.hidden);
      if (!candidates.length) { event.preventDefault(); entry.content.focus(); return; }
      const index = candidates.indexOf(this.document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + candidates.length) % candidates.length;
      event.preventDefault();
      candidates[next].focus();
    }
  }

  dispose() {
    this.root.removeEventListener('keydown', this.key);
    this.root.removeEventListener('pointerdown', this.pointer, true);
    for (const entry of [...this.entries]) this.dismiss(entry);
    this.entries.length = 0;
    this.layer.remove();
    super.dispose();
  }
}
