/** Minimal explicit DOM adapter for controller ownership tests; browser layout is qualified separately. */
export class DiskTestElement extends EventTarget {
  constructor(document, name) {
    super();
    this.ownerDocument = document;
    this.tagName = name.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.hidden = false;
    this.value = '';
    this.text = '';
    this.parentNode = null;
  }

  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }

  append(...children) {
    for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); }
  }

  before(child) {
    const parent = this.parentNode;
    if (!parent) return;
    child.remove();
    child.parentNode = parent;
    parent.children.splice(parent.children.indexOf(this), 0, child);
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }

  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.text = '';
    this.append(...children);
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = node => {
      for (const child of node.children) {
        const match = selector.startsWith('.') ? child.className.split(' ').includes(selector.slice(1))
          : child.tagName === selector.toUpperCase();
        if (match) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  click() { this.dispatchEvent(new Event('click')); }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    this.listeners.get(type)?.delete(listener);
  }
}

export function diskTestView(callbacks = {}) {
  const document = {createElement: name => new DiskTestElement(document, name)};
  const element = document.createElement('section');
  const tree = document.createElement('div');
  const search = document.createElement('input');
  element.append(search, tree);
  return {element, tree, search, ...callbacks};
}
