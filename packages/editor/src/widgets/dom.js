export function node(document, tag, attributes = {}, text) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') element.className = value;
    else if (name === 'hidden' || name === 'checked' || name === 'disabled') element[name] = value;
    else element.setAttribute(name, String(value));
  }
  if (text !== undefined) element.textContent = String(text);
  return element;
}

export function button(document, label, action, attributes = {}) {
  const element = node(document, 'button', {type: 'button', ...attributes}, label);
  element.addEventListener('click', action);
  return element;
}

export function labeledInput(document, label, attributes = {}) {
  const wrapper = node(document, 'label', {className: 'sf-insight-field'});
  const input = node(document, 'input', {'aria-label': label, ...attributes});
  wrapper.append(node(document, 'span', {}, label), input);
  return {wrapper, input};
}

export function checkbox(document, label, checked = false) {
  return labeledInput(document, label, {type: 'checkbox', checked});
}

/** Owns listeners and timers so editor disposal and pop-out window transfer are deterministic. */
export class WidgetLifetime {
  constructor() {
    this.disposables = [];
    this.timers = new Map();
    this.disposed = false;
  }

  listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    this.disposables.push(() => target.removeEventListener(type, callback, options));
  }

  delay(key, callback, milliseconds) {
    this.cancel(key);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      if (!this.disposed) callback();
    }, milliseconds);
    this.timers.set(key, timer);
  }

  cancel(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  dispose() {
    this.disposed = true;
    for (const key of this.timers.keys()) this.cancel(key);
    for (const dispose of this.disposables.splice(0)) dispose();
  }
}

export function uniqueDomId(document, prefix) {
  let index = 1;
  while (document.getElementById(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

export class EditorPopup {
  constructor(context, name, role = 'dialog') {
    this.context = context;
    const alias = {'completion-list': 'sf-completions', 'quick-info': 'sf-tooltip', 'find-replace': 'sf-find'}[name] ?? '';
    this.element = node(context.document, 'section', {className: `sf-insight-popup sf-${name} ${alias} hidden`,
      role, 'aria-label': name, hidden: true});
    context.editor.element.append(this.element);
    this.element.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        context.editor.focus();
      }
    });
  }

  get visible() { return !this.element.hidden; }

  show(offset = this.context.editor.offset) {
    this.offset = offset;
    this.element.hidden = false;
    this.element.classList.remove('hidden');
    this.position();
  }

  position() {
    if (!this.visible) return;
    const editor = this.context.editor;
    const coordinates = editor.view?.coordsAt?.(this.offset);
    const fallback = editor.sourceSnapshot().positionAt(this.offset);
    const left = coordinates?.left ?? 76 + fallback.character * 8.4 - (editor.input.scrollLeft ?? 0);
    const top = coordinates?.top ?? 14 + fallback.line * (editor.lineHeight ?? 22) - (editor.input.scrollTop ?? 0);
    const width = editor.element.clientWidth || 800;
    const height = editor.element.clientHeight || 600;
    this.element.style.left = `${Math.max(0, Math.min(left, width - (this.element.offsetWidth || 360)))}px`;
    this.element.style.top = `${Math.max(0, Math.min(top + (coordinates?.height ?? 22), height - (this.element.offsetHeight || 160)))}px`;
  }

  close() { this.element.hidden = true; this.element.classList.add('hidden'); }
  dispose() { this.element.remove(); }
}

export function contentsText(contents) {
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(contentsText).join('\n\n');
  return contents?.value ?? contents?.text ?? '';
}

/** Restricts rich provider content to plain text; no raw HTML or command links enter the DOM. */
export function appendDocumentation(parent, contents) {
  const text = contentsText(contents);
  if (text) parent.append(node(parent.ownerDocument, 'div', {className: 'sf-insight-documentation'}, text));
}
