import {resourceDom} from './a18-resource-dom.js';

/** Adds source-node identity and listener removal to the shared explicit controller DOM fixture. */
export function sessionDom() {
  const fixture = resourceDom();
  const createElement = fixture.document.createElement;
  fixture.document.createElement = tag => {
    const element = createElement(tag);
    Object.defineProperty(element, 'childNodes', {get: () => [...element.children]});
    element.removeEventListener = (name, callback) => {
      const listeners = element.listeners.get(name) ?? [];
      element.listeners.set(name, listeners.filter(listener => listener !== callback));
    };
    return element;
  };
  return fixture;
}
