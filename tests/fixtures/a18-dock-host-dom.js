import {resourceDom} from './a18-resource-dom.js';

/** Explicit DOM boundary for the real docking model/host; records connected-node detachments during focus. */
export function dockHostDom() {
  const fixture = resourceDom();
  const {document} = fixture;
  const createElement = document.createElement;
  const window = document.defaultView;
  document.listeners = new Map();
  document.addEventListener = (type, listener, options) => addListener(document, type, listener, options);
  document.createElement = tag => enrich(createElement(tag));
  document.createDocumentFragment = () => document.createElement('#fragment');
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  document.documentElement = document.createElement('html');
  document.head = document.createElement('head');
  document.documentElement.append(document.head, document.body);
  Object.assign(window, {
    document,
    listeners: new Map(),
    addEventListener(type, listener, options) { addListener(window, type, listener, options); },
    focus() { emit(window, 'focus'); },
    close() { window.closed = true; emit(window, 'pagehide'); },
    open: () => dockHostDom().document.defaultView
  });
  enrich(document.body);
  const element = document.createElement('main');
  document.body.append(element);
  return {...fixture, element};
}

function addListener(target, type, listener, options = {}) {
  if (!target.listeners.has(type)) target.listeners.set(type, []);
  const invoke = event => {
    if (options.signal?.aborted) return;
    listener(event);
    if (options.once) {
      const listeners = target.listeners.get(type);
      listeners.splice(listeners.indexOf(invoke), 1);
    }
  };
  target.listeners.get(type).push(invoke);
}

function emit(target, type, values = {}) {
  const event = {type, target, defaultPrevented: false, ...values,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; this.immediate = true; }};
  for (let current = target; current; current = current.parentElement) {
    for (const listener of [...(current.listeners?.get(type) ?? [])]) {
      listener(event);
      if (event.immediate) break;
    }
    if (!event.immediate) current['on' + type]?.(event);
    if (event.stopped) break;
  }
  if (!event.stopped && target.ownerDocument) {
    for (const listener of [...(target.ownerDocument.listeners.get(type) ?? [])]) listener(event);
  }
  return event;
}

function adopt(element, document) {
  element.ownerDocument = document;
  for (const child of element.children) adopt(child, document);
}

function enrich(element) {
  element.clientWidth = 1200;
  element.clientHeight = 800;
  element.scrollWidth = 1200;
  element.scrollLeft = 0;
  element.scrollTop = 0;
  element.detachments = 0;
  element.addEventListener = (type, listener, options) => addListener(element, type, listener, options);
  element.dispatch = (type, values) => emit(element, type, values);
  element.focus = () => {
    if (element.ownerDocument.activeElement === element) return;
    element.ownerDocument.activeElement = element;
    emit(element, 'focusin');
  };
  element.contains = node => {
    for (let current = node; current; current = current.parentElement) if (current === element) return true;
    return false;
  };
  element.getBoundingClientRect = () => ({left: 0, top: 0, right: element.clientWidth, bottom: element.clientHeight,
    width: element.clientWidth, height: element.clientHeight});
  element.scrollBy = ({left = 0, top = 0}) => {
    element.scrollLeft += left;
    element.scrollTop += top;
  };
  const remove = element.remove.bind(element);
  element.remove = () => {
    if (element.parentElement && element.isConnected) element.detachments++;
    remove();
  };
  const append = element.append.bind(element);
  element.append = (...children) => {
    for (const child of children) {
      if (child.tagName === '#FRAGMENT') element.append(...child.children);
      else {
        append(child);
        if (child.ownerDocument !== element.ownerDocument) adopt(child, element.ownerDocument);
      }
    }
  };
  const matches = element.matches.bind(element);
  element.matches = selector => selector.split(',').some(part => {
    const value = part.trim();
    return value === '[hidden]' ? element.hidden : matches(value);
  });
  return element;
}
