/** Explicit DOM/host boundary for resource controllers; scenes come from the real designer projection. */
export function resourceDom() {
  const observers = [];
  const document = {activeElement: null, defaultView: {ResizeObserver: class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }}};
  document.createElement = tag => new ResourceElement(document, tag);
  document.body = document.createElement('body');
  document.body.connected = true;
  return {document, observers};
}

class ResourceElement {
  constructor(document, tag) {
    this.ownerDocument = document;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.inert = false;
    this.text = '';
    this.classList = {
      contains: value => this.className.split(' ').includes(value),
      add: value => this.setClass(value, true),
      remove: value => this.setClass(value, false),
      toggle: (value, enabled) => this.setClass(value, enabled)
    };
  }

  get isConnected() { return !!this.connected || !!this.parentElement?.isConnected; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }

  setClass(value, enabled) {
    const classes = new Set(this.className.split(' ').filter(Boolean));
    if (enabled) classes.add(value);
    else classes.delete(value);
    this.className = [...classes].join(' ');
  }

  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  insertBefore(child, before) {
    if (!before) return this.append(child);
    const index = this.children.indexOf(before);
    if (index < 0) throw new Error('Reference node is not a child');
    child.remove();
    child.parentElement = this;
    this.children.splice(index, 0, child);
  }

  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.text = '';
    this.append(...children);
  }

  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  async fire(name) {
    if (this.disabled) return;
    const event = {target: this, preventDefault() {}, stopPropagation() {}};
    for (const callback of this.listeners.get(name) ?? []) await callback(event);
    await this['on' + name]?.(event);
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  showModal() { this.open = true; }
  close() { this.open = false; }

  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) {
      const name = attribute[1];
      const value = name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] :
        this.getAttribute(name);
      return value !== undefined && value !== null && (attribute[2] === undefined || String(value) === attribute[2]);
    }
    return this.tagName.toLowerCase() === selector;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map(value => value.trim());
    const direct = selectors[0].startsWith(':scope > ');
    const matches = element => selectors.some(value => element.matches(value.replace(':scope > ', '')));
    const result = [];
    const visit = element => {
      for (const child of element.children) {
        if (matches(child)) result.push(child);
        if (!direct) visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) if (element.matches(selector)) return element;
    return null;
  }
}

export function resourceView(model, {connected = true} = {}) {
  const dom = resourceDom();
  const container = dom.document.createElement('main');
  const panels = new Map();
  for (const id of ['designer', 'designer-toolbox', 'designer-properties', 'designer-layout', 'designer-tree', 'designer-styles']) {
    const panel = dom.document.createElement('section');
    panel.id = id;
    panels.set(id, panel);
    container.append(panel);
  }
  if (connected) dom.document.body.append(container);
  const stage = dom.document.createElement('div');
  const status = dom.document.createElement('p');
  const scroller = dom.document.createElement('div');
  scroller.append(stage);
  panels.get('designer').append(scroller, status);
  const environment = {value: {theme: 'light', contrast: 'normal'}, update(patch) { Object.assign(this.value, patch); }};
  const errors = [];
  const activations = [];
  const assets = new Map();
  const view = {
    document: model, session: {document: model, kind: 'resources'}, stage, statusElement: status, scroller,
    panel: id => panels.get(id), controlsRoot: dom.document.createElement('nav'),
    chrome: {commandBar: {layout() {}}}, docking: {activate: id => activations.push(id)},
    surface: {preview: {environment, get value() { return environment.value; }, toolbar: dom.document.createElement('nav')}},
    resources: {selectedKey: null, search: '', render() { this.renders = (this.renders ?? 0) + 1; }},
    assetPreviews: {urls: assets, resolve: uri => assets.get(uri)}, assetPreviewController: {version: 0},
    error: error => errors.push(error), safe: async action => action(),
    sourceSync: {session: {analysis: {canApply: false, diagnostics: [{code: 'SFD1884', severity: 'error'}]}}}
  };
  return {...dom, view, panels, container, errors, activations, assets};
}
