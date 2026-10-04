/** Minimal control/event boundary for settings dialogs; it does not emulate browser layout or focus policy. */
class SettingsElement extends EventTarget {
  constructor(document, tagName) {
    super();
    this.ownerDocument = document;
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {setProperty() {}};
    this.text = '';
    this.explicitValue = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get options() { return this.children; }
  get value() {
    if (this.tagName !== 'select') return this.attributes.value ?? '';
    return (this.children.find(child => child.selected) ?? (!this.explicitValue && this.children[0]))?.value ?? '';
  }
  set value(value) {
    if (this.tagName !== 'select') this.attributes.value = String(value);
    else {
      this.explicitValue = true;
      for (const option of this.children) option.selected = option.value === String(value);
    }
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parent = null;
    this.children = [];
    this.append(...nodes);
  }
  querySelectorAll(selector) {
    const predicate = selector.startsWith('[') ? node => Object.hasOwn(node.attributes, selector.slice(1, -1))
      : node => node.tagName === selector;
    return descendants(this, predicate);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
}

export function descendants(root, predicate) {
  return root.children.flatMap(child => [...(predicate(child) ? [child] : []), ...descendants(child, predicate)]);
}

export function createSettingsDialogs() {
  const document = {
    createElement: tag => new SettingsElement(document, tag),
    createTextNode: text => {
      const node = new SettingsElement(document, '#text');
      node.textContent = text;
      return node;
    }
  };
  document.documentElement = document.createElement('html');
  const handles = [];
  return {
    document, handles,
    get current() { return handles.at(-1); },
    open(options) {
      const controller = new AbortController();
      const host = document.createElement('div');
      let cleanup;
      const handle = {
        options, host, signal: controller.signal, closed: false,
        close(value) {
          if (this.closed) return;
          this.closed = true;
          this.value = value;
          controller.abort();
          cleanup?.();
        },
        async run(label) {
          if (this.closed) throw new Error('Dialog is closed');
          const action = options.actions.find(item => item.label === label);
          if (!action) throw new Error('Unknown dialog action ' + label);
          const value = await action.run(this);
          if (value !== false && action.close !== false) this.close(value);
          return value;
        },
        control(label) {
          const control = descendants(host, node => node.attributes['aria-label'] === label)[0];
          if (!control) throw new Error('Missing labelled control ' + label);
          return control;
        }
      };
      handles.push(handle);
      cleanup = options.render(host, handle);
      return handle;
    }
  };
}

export function choose(handle, label, value) {
  const control = handle.control(label);
  control.value = value;
  control.dispatchEvent(new Event('change'));
}

export function memorySettingsStorage() {
  const values = new Map();
  return {
    values,
    writes: 0,
    fail: false,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.fail) throw new Error('Settings quota exceeded');
      values.set(key, value);
      this.writes++;
    }
  };
}
