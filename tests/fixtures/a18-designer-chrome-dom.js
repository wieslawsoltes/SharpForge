import {editorDom} from './a18-editor-dom.js';

/** Trusted markup, sizing and focus boundaries only; the command bar and resource context are production code. */
export function designerChromeDom() {
  const fixture = editorDom();
  const {document} = fixture;
  const createElement = document.createElement;
  const listeners = new Map();
  document.addEventListener = (type, listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(listener);
  };
  document.removeEventListener = (type, listener) => listeners.get(type)?.delete(listener);
  document.createElement = tag => {
    const element = createElement(tag);
    const matches = element.matches.bind(element);
    element.matches = selector => selector.split(',').some(part => {
      if (part === '[hidden]') return element.hidden;
      if (part.includes(':not(:disabled)') && element.disabled) return false;
      return matches(part.replace(':not(:disabled)', '').trim());
    });
    element.contains = node => {
      for (let current = node; current; current = current.parentElement) if (current === element) return true;
      return false;
    };
    element.prepend = (...children) => {
      const before = element.children[0];
      for (const child of children) element.insertBefore(child, before);
    };
    element.getBoundingClientRect = () => ({left: 0, top: 0, right: element.clientWidth, bottom: 36,
      width: element.clientWidth, height: 36});
    element.getClientRects = () => element.closest('[hidden]') ? [] : [element.getBoundingClientRect()];
    Object.defineProperties(element, {
      firstElementChild: {get: () => element.children.find(child => !child.tagName.startsWith('#')) ?? null},
      offsetWidth: {get: () => element.hidden ? 0 : element.tagName === 'BUTTON' ? 44 : 80},
      scrollWidth: {get: () => element.children.reduce((width, child) => width + child.offsetWidth, 0)}
    });
    return element;
  };
  document.documentElement = document.createElement('html');
  document.documentElement.clientWidth = 1200;
  return {...fixture, listeners};
}
