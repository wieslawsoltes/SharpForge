import { ControlEvents, ControlError } from '../policy/events.js';

export const AcceleratorModifiers = Object.freeze({ None: 0, Menu: 1, Control: 2, Shift: 4, Windows: 8 });

const virtualKeys = Object.freeze({ 8: 'Backspace', 9: 'Tab', 13: 'Enter', 19: 'Pause', 27: 'Escape', 32: ' ',
  33: 'PageUp', 34: 'PageDown', 35: 'End', 36: 'Home', 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight',
  40: 'ArrowDown', 45: 'Insert', 46: 'Delete', 93: 'ContextMenu' });

export function acceleratorKey(value) {
  if (typeof value === 'string') return value;
  if (Number.isInteger(value) && (value >= 48 && value <= 90)) return String.fromCharCode(value);
  if (Number.isInteger(value) && value >= 112 && value <= 135) return 'F' + (value - 111);
  if (Object.hasOwn(virtualKeys, value)) return virtualKeys[value];
  throw new ControlError('SFUI1652', 'VirtualKey has no supported browser keyboard mapping', { value });
}

function modifiers(event) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.shiftKey ? 4 : 0) | (event.metaKey ? 8 : 0);
}

/** One router per host root. Keyboard gestures never route into a different application. */
export class KeyboardAcceleratorRouter extends ControlEvents {
  constructor(root) {
    super();
    this.root = root;
    this.entries = new Map();
    this.accessKeys = new Map();
    this.menuBars = new Set();
    this.previousMenuFocus = null;
    this.keyTips = [];
    this.accessMode = false;
    this.accessPrefix = '';
    this.next = 0;
    this.listener = event => this.process(event);
    root.addEventListener('keydown', this.listener);
  }

  register({ key, modifiers: flags = 0, scope = this.root, enabled = () => true, invoke, label = '' }) {
    key = acceleratorKey(key);
    if (typeof invoke !== 'function' || !scope) throw new ControlError('SFUI1652', 'Invalid keyboard accelerator');
    const id = ++this.next;
    this.entries.set(id, { key: key.toLocaleLowerCase(), modifiers: flags, scope, enabled, invoke, label });
    return () => this.entries.delete(id);
  }

  registerAccessKey(key, element, invoke) {
    const normalized = String(key).toLocaleLowerCase();
    if (!normalized || normalized.length > 4) throw new ControlError('SFUI1653', 'Access key must have 1..4 characters');
    const entry = { element, invoke, key: normalized };
    let entries = this.accessKeys.get(normalized);
    if (!entries) this.accessKeys.set(normalized, entries = new Set());
    entries.add(entry);
    return () => { entries.delete(entry); if (!entries.size) this.accessKeys.delete(normalized); };
  }

  registerMenuBar(element, activate) {
    const entry = { element, activate };
    this.menuBars.add(entry);
    return () => this.menuBars.delete(entry);
  }

  process(event) {
    if (!this.root.contains(event.target) || event.isComposing || event.defaultPrevented) return false;
    if (event.key === 'Alt' || event.key === 'F10' && !event.shiftKey) {
      this.showAccessKeys();
      for (const entry of this.menuBars) {
        if (!this.root.contains(entry.element) || entry.element.closest('[hidden]')) continue;
        this.previousMenuFocus = this.root.ownerDocument.activeElement;
        entry.activate();
        event.preventDefault();
        break;
      }
      return false;
    }
    if (event.key === 'Escape') {
      this.hideAccessKeys();
      if (this.previousMenuFocus && this.root.contains(this.previousMenuFocus)) this.previousMenuFocus.focus();
      this.previousMenuFocus = null;
      return false;
    }
    const key = event.key.toLocaleLowerCase();
    if ((event.altKey || this.accessMode) && key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const prefix = this.accessPrefix + key;
      const matches = [...this.accessKeys.keys()].filter(value => value.startsWith(prefix));
      if (matches.length && !this.accessKeys.has(prefix)) {
        this.accessMode = true;
        this.accessPrefix = prefix;
        event.preventDefault();
        return true;
      }
      for (const entry of this.accessKeys.get(prefix) ?? []) {
        if (!this.root.contains(entry.element) || entry.element.hidden || entry.element.disabled) continue;
        entry.invoke(event);
        event.preventDefault();
        this.hideAccessKeys();
        return true;
      }
      this.hideAccessKeys();
    }
    for (const entry of this.entries.values()) {
      if (entry.key !== key || entry.modifiers !== modifiers(event) || !entry.scope.contains(event.target) || !entry.enabled()) continue;
      const args = { Handled: false, event };
      const result = entry.invoke(args);
      if (result === true || args.Handled) { event.preventDefault(); return true; }
    }
    return false;
  }

  showAccessKeys() {
    this.hideAccessKeys();
    this.accessMode = true;
    for (const entries of this.accessKeys.values()) for (const entry of entries) {
      if (!this.root.contains(entry.element)) continue;
      const tip = this.root.ownerDocument.createElement('span');
      tip.textContent = entry.key.toUpperCase();
      tip.dataset.accessKeyTip = '';
      tip.setAttribute('aria-hidden', 'true');
      entry.element.append(tip);
      this.keyTips.push(tip);
    }
    this.emit('AccessKeyDisplayRequested', {});
  }

  hideAccessKeys() {
    this.accessMode = false;
    this.accessPrefix = '';
    for (const tip of this.keyTips) tip.remove();
    this.keyTips.length = 0;
    this.emit('AccessKeyDisplayDismissed', {});
  }

  dispose() {
    this.hideAccessKeys();
    this.root.removeEventListener('keydown', this.listener);
    this.entries.clear();
    this.accessKeys.clear();
    this.menuBars.clear();
    this.previousMenuFocus = null;
    super.dispose();
  }
}
