/** Minimal event-driven DOM for owned UI contract fixtures; it is not a native-browser qualification. */
export class FixtureElement {
  constructor(tag, document) {
    Object.assign(this, { tag, ownerDocument: document, nodeType: 1, children: [], listeners: new Map(), value: '', ownText: '' });
  }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  set textContent(text) { this.ownText = String(text); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent ?? '').join(''); }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.ownText = ''; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.removed = true; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener)); }
  async dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) await listener({ type, target: this, preventDefault() {} });
  }
  querySelector(selector) { return fixtureDescendants(this).find(element => selector.split(',').includes(element.tag)); }
  reportValidity() { return true; }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.ownerDocument.onShow?.(this); }
  close() { this.open = false; void this.dispatch('close'); }
}

export function fixtureDocument() {
  const document = { elements: [], createElement(tag) {
    const element = new FixtureElement(tag, document);
    document.elements.push(element);
    return element;
  }, createTextNode(text) { return { textContent: String(text), nodeType: 3 }; } };
  document.body = document.createElement('body');
  return document;
}

export function fixtureDescendants(element) { return [element, ...(element.children ?? []).flatMap(fixtureDescendants)]; }
