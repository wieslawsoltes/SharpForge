// A small DOM event harness checks renderer wiring; native browser qualification remains separate.
class Element {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    this.text = '';
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); this[name] = value; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.text = ''; this.append(...children); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Repository tools must construct text nodes instead of parsing HTML'); }
  addEventListener(type, callback, options = {}) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], { callback, once: options.once }]);
  }
  async emit(type) {
    for (const listener of [...this.listeners.get(type) ?? []]) {
      if (listener.once) this.listeners.set(type, this.listeners.get(type).filter(item => item !== listener));
      await listener.callback({ type, target: this, preventDefault() {} });
    }
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',');
    return descendants(this).filter(element => selectors.some(value => {
      const match = /^([a-z]+)(?:\[([a-z]+)="([^"]+)"\])?$/u.exec(value);
      return match && element.tagName === match[1].toUpperCase() && (!match[2] || element.getAttribute(match[2]) === match[3]);
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  reportValidity() { return true; }
  showModal() { this.open = true; }
  close() { if (this.open) { this.open = false; void this.emit('close'); } }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); }
  focus() { this.ownerDocument.activeElement = this; }
}

export function descendants(element) {
  return element.children.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []);
}

export function toolsDocument(confirm = () => true) {
  const document = {
    defaultView: { confirm },
    createElement(tag) { return new Element(this, tag); },
    createTextNode(value) { return { nodeType: 3, textContent: String(value) }; }
  };
  document.body = document.createElement('body');
  return document;
}
