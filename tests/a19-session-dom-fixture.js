class Element extends EventTarget {
  constructor(document, tag) {
    super();
    this.ownerDocument = document;
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.classes = new Set();
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
    this.textWrites = 0;
    this.text = '';
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  get textContent() { return this.text; }
  set textContent(value) { this.textWrites++; this.text = String(value); }
  get value() {
    return this.tagName === 'select' ? (this.children.find(child => child.selected) ?? this.children[0])?.value ?? ''
      : this.attributes.value ?? '';
  }
  set value(value) {
    if (this.tagName === 'select') for (const option of this.children) option.selected = option.value === String(value);
    else this.attributes.value = String(value);
  }
  append(...nodes) {
    for (const node of nodes) { node.parent = this; this.children.push(node); }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }
}

export function sessionDomRoot() {
  const document = { createElement: tag => new Element(document, tag) };
  return document.createElement('div');
}

export function descendants(root, predicate) {
  return root.children.flatMap(child => [...(predicate(child) ? [child] : []), ...descendants(child, predicate)]);
}
