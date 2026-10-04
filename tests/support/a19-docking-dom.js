import assert from 'node:assert/strict';

class DockElement extends EventTarget {
  constructor(document, tagName) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = new Map();
    this.style = {};
    this.className = '';
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), name])].join(' '); },
      remove: name => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); },
      toggle: (name, enabled) => enabled ? this.classList.add(name) : this.classList.remove(name)
    };
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 1000;
    this.clientHeight = 700;
    this.scrollWidth = 1000;
  }

  get isConnected() { return this === this.ownerDocument.body || Boolean(this.parentElement?.isConnected); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node.tagName === '#fragment') this.append(...[...node.children]);
      else {
        node.remove();
        node.parentElement = this;
        this.children.push(node);
      }
    }
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) child.remove();
    this.append(...nodes);
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/u.exec(selector);
    assert.ok(attribute, `Unsupported fixture selector: ${selector}`);
    const [, name, expected] = attribute;
    const value = name.startsWith('data-')
      ? this.dataset[name.slice(5).replace(/-([a-z])/gu, (_match, letter) => letter.toUpperCase())]
      : name === 'hidden' ? this.hidden ? '' : undefined : this.attributes.get(name);
    return value !== undefined && (expected === undefined || value === expected);
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700}; }
  focus() { this.ownerDocument.activeElement = this; }
}

/** Only the DOM transport is synthetic; DockHost, DockLayout, tabs and document ownership run unchanged. */
export function dockingDom() {
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  document.createElement = tagName => new DockElement(document, tagName);
  document.createDocumentFragment = () => document.createElement('#fragment');
  document.body = document.createElement('body');
  document.activeElement = document.body;
  const root = document.createElement('div');
  document.body.append(root);
  return {document, root};
}
