function dataKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

class DockElement extends EventTarget {
  constructor(document, tag) {
    super();
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.classes = new Set();
    this.style = {};
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 1000;
    this.clientHeight = 700;
    this.scrollWidth = 1000;
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, enabled = !this.classes.has(name)) => {
        if (enabled) this.classes.add(name);
        else this.classes.delete(name);
        return enabled;
      }
    };
  }

  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent).join(''); }
  get isConnected() {
    return this === this.ownerDocument.documentElement || Boolean(this.parentElement?.isConnected);
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
    if (name === 'hidden') return this.hidden ? '' : null;
    return this.attributes.get(name) ?? null;
  }

  adopt(document) {
    this.ownerDocument = document;
    for (const child of this.children) child.adopt(document);
  }

  append(...children) {
    for (const child of children) {
      if (child.tagName === '#FRAGMENT') { this.append(...child.children); continue; }
      child.remove();
      child.parentElement = this;
      child.adopt(this.ownerDocument);
      this.children.push(child);
    }
  }

  replaceChildren(...children) {
    for (const child of [...this.children]) child.remove();
    this.text = '';
    this.append(...children);
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  matches(selector) {
    return selector.split(',').some(part => {
      const direct = part.trim().split(' > ');
      if (direct.length === 2) return this.matches(direct[1]) && Boolean(this.parentElement?.matches(direct[0]));
      const match = /^([a-z]+)?(?:\.([\w-]+))?(?:\[([^=\]]+)(?:="([^"]*)")?\])?$/i.exec(part.trim());
      if (!match) throw new Error(`Unsupported docking fixture selector: ${part}`);
      const [, tag, className, attribute, value] = match;
      return (!tag || this.tagName === tag.toUpperCase()) && (!className || this.classes.has(className))
        && (!attribute || (value === undefined ? this.getAttribute(attribute) !== null : this.getAttribute(attribute) === value));
    });
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  focus() { this.ownerDocument.activeElement = this; }
  scrollBy({ left = 0, top = 0 }) { this.scrollLeft += left; this.scrollTop += top; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
}

/** Retained DOM, adoption and event ownership for the real docking renderer; no browser geometry or input qualification. */
export function dockingDocument() {
  const document = new EventTarget();
  document.createElement = tag => new DockElement(document, tag);
  document.createDocumentFragment = () => new DockElement(document, '#fragment');
  document.documentElement = document.createElement('html');
  document.head = document.createElement('head');
  document.body = document.createElement('body');
  document.documentElement.append(document.head, document.body);
  document.activeElement = document.body;
  document.querySelectorAll = selector => document.documentElement.querySelectorAll(selector);
  const window = new EventTarget();
  Object.assign(window, { document, AbortController, closed: false });
  window.open = () => dockingDocument().defaultView;
  window.focus = () => window.dispatchEvent(new Event('focus'));
  window.close = () => {
    window.dispatchEvent(new Event('beforeunload'));
    window.closed = true;
    window.dispatchEvent(new Event('pagehide'));
  };
  document.defaultView = window;
  return document;
}
