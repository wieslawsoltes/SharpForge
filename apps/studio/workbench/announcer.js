import {element} from './ui.js';

export class Announcer {
  constructor(root) {
    this.seen = new Set();
    this.nodes = new Map();
    for (const politeness of ['polite', 'assertive']) {
      const node = element(root.ownerDocument, 'div', {className: 'wb-sr-only', 'aria-live': politeness, 'aria-atomic': 'true'});
      root.append(node);
      this.nodes.set(politeness, node);
    }
  }
  announce(message, {id, politeness = 'polite'} = {}) {
    if (id && this.seen.has(id)) return false;
    if (id) {
      this.seen.add(id);
      if (this.seen.size > 1024) this.seen.delete(this.seen.values().next().value);
    }
    const node = this.nodes.get(politeness);
    if (!node) throw new TypeError('Unknown announcement politeness');
    node.textContent = String(message);
    return true;
  }
  dispose() { for (const node of this.nodes.values()) node.remove(); this.seen.clear(); }
}
