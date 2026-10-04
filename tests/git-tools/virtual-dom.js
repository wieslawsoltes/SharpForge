import { FixtureElement } from '../a25-auth-ui-fixture.js';

class VirtualElement extends FixtureElement {
  constructor(tag, document) {
    super(tag, document);
    this.style = {};
    this.clientHeight = 329;
    this.scrollTop = 0;
  }

  append(...children) {
    for (const child of children) {
      if (child.nodeType === 11) super.append(...child.children);
      else super.append(child);
    }
  }

  getContext() { return null; }
}

/** Advance explicit animation frames without browser timing or a copied renderer. */
export function virtualDocument() {
  const frames = new Map();
  const observers = new Set();
  let nextFrame = 0;
  const document = {
    createElement(tag) { return new VirtualElement(tag, this); },
    createTextNode(text) { return { textContent: String(text), nodeType: 3 }; },
    createDocumentFragment() {
      const fragment = this.createElement('fragment');
      fragment.nodeType = 11;
      return fragment;
    },
    defaultView: {
      devicePixelRatio: 1,
      requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame(handle) { frames.delete(handle); },
      ResizeObserver: class {
        constructor(callback) { this.callback = callback; }
        observe() { observers.add(this); }
        disconnect() { observers.delete(this); }
      }
    }
  };
  const frame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback();
  };
  return { document, frames, observers, frame, async flush() {
    for (let turn = 0; turn < 8; turn++) {
      await Promise.resolve();
      frame();
    }
  } };
}
