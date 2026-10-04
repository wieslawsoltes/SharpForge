import {CodeEditor} from '@sharpforge/editor';
import {editorDom} from './a18-editor-dom.js';

/** The DOM/native-input/animation boundary only; model, lexer, view and keymap are the production exports. */
export function virtualEditorDom() {
  const fixture = editorDom();
  const {document} = fixture;
  const create = document.createElement;
  const frames = new Map();
  let nextFrame = 0;
  const writes = {replacements: 0, styles: 0, nativeValues: 0, nativeSelections: 0};
  const listeners = new Map();
  document.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  document.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
  document.createElement = tag => enrichElement(create(tag), writes);
  enrichElement(fixture.element, writes);
  enrichElement(document.body, writes);
  document.getElementById = id => document.body.querySelector('#' + id);
  document.createDocumentFragment = () => document.createElement('#fragment');
  document.createTextNode = text => {
    const node = document.createElement('#text');
    node.textContent = text;
    return node;
  };
  Object.assign(document.defaultView, {
    HTMLTextAreaElement: nativeTextarea(writes), matchMedia: () => ({matches: false}), navigator: {},
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id)
  });
  return {...fixture, frames, writes, flushFrames() {
    let count = 0;
    while (frames.size) {
      if (++count > 10) throw new Error('Editor frame queue did not settle');
      const pending = [...frames];
      frames.clear();
      for (const [, callback] of pending) callback(0);
    }
  }};
}

function nativeTextarea(writes) {
  return class NativeTextarea {
    get value() { return this.nativeText ?? ''; }
    set value(value) { writes.nativeValues++; this.nativeText = String(value); }
    get selectionStart() { return this.nativeSelectionStart ?? 0; }
    set selectionStart(value) { this.nativeSelectionStart = value; }
    get selectionEnd() { return this.nativeSelectionEnd ?? 0; }
    set selectionEnd(value) { this.nativeSelectionEnd = value; }
    setSelectionRange(start, end, direction) {
      writes.nativeSelections++;
      this.nativeSelectionStart = start;
      this.nativeSelectionEnd = end;
      this.nativeSelectionDirection = direction;
    }
  };
}

function enrichElement(element, writes) {
  element.replaceWrites = 0;
  const setAttribute = element.setAttribute.bind(element);
  element.setAttribute = (name, value) => {
    setAttribute(name, value);
    if (['id', 'value', 'type'].includes(name)) element[name] = String(value);
  };
  const style = {...element.style};
  style.setProperty = (name, value) => { writes.styles++; style[name] = String(value); };
  style.getPropertyValue = name => style[name] ?? '';
  style.removeProperty = name => { const old = style[name]; delete style[name]; return old; };
  element.style = style;
  element.getContext = () => null;
  element.getBoundingClientRect = () => ({left: 0, top: 0, right: element.clientWidth ?? 800,
    bottom: element.clientHeight ?? 440, width: element.clientWidth ?? 800, height: element.clientHeight ?? 440});
  element.contains = node => {
    for (let item = node; item; item = item.parentElement) if (item === element) return true;
    return false;
  };
  element.scrollTo = ({top, left}) => {
    element.scrollTop = element.clampScroll ? Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight)) : top;
    element.scrollLeft = element.clampScroll ? Math.max(0, Math.min(left, element.scrollWidth - element.clientWidth)) : left;
  };
  element.select = () => element.setSelectionRange(0, element.value.length);
  const add = element.classList.add;
  const remove = element.classList.remove;
  element.classList.add = (...values) => { for (const value of values) add(value); };
  element.classList.remove = (...values) => { for (const value of values) remove(value); };
  element.classList.toggle = (value, enabled = !element.classList.contains(value)) => {
    (enabled ? add : remove)(value);
    return enabled;
  };
  const append = element.append.bind(element);
  element.append = (...items) => {
    for (let item of items) {
      if (typeof item === 'string') item = element.ownerDocument.createTextNode(item);
      if (item.tagName === '#FRAGMENT') element.append(...item.children);
      else append(item);
    }
  };
  element.appendChild = child => { element.append(child); return child; };
  element.prepend = (...items) => {
    const before = element.children[0];
    for (const item of items) element.insertBefore(item, before);
  };
  const replace = element.replaceChildren.bind(element);
  element.replaceChildren = (...children) => {
    writes.replacements++;
    element.replaceWrites++;
    replace(...children);
  };
  Object.defineProperties(element, {
    childElementCount: {get: () => element.children.filter(child => !child.tagName.startsWith('#')).length},
    firstChild: {get: () => element.children[0] ?? null}, lastChild: {get: () => element.children.at(-1) ?? null},
    options: {get: () => element.children.filter(child => child.tagName === 'OPTION')},
    title: {get: () => element.getAttribute('title') ?? '', set: value => element.setAttribute('title', String(value))},
    scrollHeight: {get: () => Math.max(element.clientHeight ?? 440, parseFloat(element.children[0]?.style.height) || 0)},
    scrollWidth: {get: () => Math.max(element.clientWidth ?? 800, parseFloat(element.children[0]?.style.width) || 0)},
    nodeType: {get: () => element.tagName === '#TEXT' ? 3 : element.tagName === '#FRAGMENT' ? 11 : 1},
    length: {get: () => element.textContent.length}
  });
  element.matches = selector => matches(element, selector);
  element.dispatch = (type, values) => dispatch(element, type, values);
  return element;
}

function dispatch(element, type, values = {}) {
  const event = {type, target: element, defaultPrevented: false, cancelable: true, ...values,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; }};
  for (const listener of [...(element.listeners.get(type) ?? [])]) {
    listener(event);
    if (event.stopped) break;
  }
  if (!event.stopped) element['on' + type]?.(event);
  return event;
}

function matches(element, selector) {
  if (selector.includes(',')) return selector.split(',').some(part => matches(element, part.trim()));
  const excluded = selector.match(/:not\(([^)]+)\)/);
  if (excluded && matches(element, excluded[1])) return false;
  selector = selector.replace(/:not\([^)]+\)/g, '');
  const tag = selector.match(/^[\w-]+/);
  if (tag && element.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!element.classList.contains(name)) return false;
  const id = selector.match(/#([\w-]+)/);
  if (id && element.id !== id[1]) return false;
  for (const [, name, quoted, plain] of selector.matchAll(/\[([^=\]]+)(?:="([^"]*)"|=([^\]\s]+))?\]/g)) {
    const value = name.startsWith('data-')
      ? element.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : element.getAttribute(name);
    const expected = quoted ?? plain;
    if (value === undefined || value === null || expected !== undefined && String(value) !== expected) return false;
  }
  return true;
}

export function createVirtualEditor(t, options = {}) {
  const fixture = virtualEditorDom();
  const editor = new CodeEditor(fixture.element, options);
  fixture.flushFrames();
  t.after(() => editor.dispose());
  return {...fixture, editor};
}

export const sourceRows = editor => editor.highlight.querySelectorAll('.sf-view-line').map(row =>
  row.children.filter(child => child.dataset.decorationOnly !== 'true').map(child => child.textContent).join(''));
export const gutterLine = (editor, line) => editor.gutter.querySelectorAll('.sf-line').find(node => node.dataset.line === String(line));
