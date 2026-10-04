import assert from 'node:assert/strict';

class MenuElement extends EventTarget {
  constructor(document, tagName) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.style = {};
    this.textContent = '';
    this.clientWidth = 1024;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this);
    this.parent = null;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) {
    assert.equal(selector, '[aria-modal="true"]');
    return this.getAttribute('aria-modal') === 'true' ? this : this.parent?.closest(selector) ?? null;
  }
  getBoundingClientRect() { return {left: 0}; }
  querySelectorAll(selector) {
    assert.equal(selector, 'button:not(:disabled)');
    return this.children.flatMap(child => [
      ...(child.tagName === 'button' && !child.disabled ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

/** Minimal DOM transport; all menu state, rendering, event handlers and command execution stay in production. */
export function menuDom() {
  const document = new EventTarget();
  document.createElement = tag => new MenuElement(document, tag);
  const host = document.createElement('div');
  const outside = document.createElement('input');
  outside.focus();
  return {document, host, outside};
}

export function menuKey(target, key, modifiers = {}) {
  const event = Object.assign(new Event('keydown', {cancelable: true}), {key, ...modifiers});
  target.dispatchEvent(event);
  return event;
}
