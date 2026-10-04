import { tabOrder, nextTabStop, findDirectionalFocus } from './tab-navigation.js';

export const FocusState = Object.freeze({ Unfocused: 0, Pointer: 1, Keyboard: 2, Programmatic: 3 });

export class FocusManager {
  constructor({ router, nodes, roots = () => [], childrenOf = () => [], layoutFor = () => null,
    focusElement = () => {}, parentOf = () => null, isTabStop = () => false, onChanged = () => {} } = {}) {
    Object.assign(this, { router, nodes, roots, childrenOf, layoutFor, focusElement, parentOf, isTabStop, onChanged });
    this.focusedElement = null;
    this.focusState = FocusState.Unfocused;
    this.disposed = false;
    this.changing = false;
  }
  isFocusable(id) {
    let current = id;
    const seen = new Set();
    while (current != null) {
      if (seen.has(current)) return false;
      seen.add(current);
      const node = this.nodes.get(current);
      if (!node) return false;
      const properties = node.properties ?? {};
      if (properties.Visibility === 1 || properties.Visible === false || properties.IsEnabled === false || properties.IsEnabled === 0) return false;
      if (current === id && (properties.IsTabStop === false || properties.IsTabStop === 0)) return false;
      current = this.parentOf(current);
    }
    return true;
  }
  focus(id, state = FocusState.Programmatic, direction = 'None') {
    if (this.disposed || this.changing || id != null && !this.isFocusable(id)) return false;
    if (id === this.focusedElement) { this.focusState = state; this.onChanged(id, id, state); return true; }
    const previous = this.focusedElement;
    this.changing = true;
    try {
      const payload = { OldFocusedElement: previous, NewFocusedElement: id, FocusState: state, Direction: direction, Cancel: false };
      const losing = previous == null ? payload : this.router.raise(previous, 'LosingFocus', payload);
      if (losing?.Cancel) return false;
      const getting = id == null ? payload : this.router.raise(id, 'GettingFocus', { ...payload, NewFocusedElement: losing?.NewFocusedElement ?? id });
      if (getting?.Cancel) return false;
      id = getting?.NewFocusedElement ?? id;
      if (id != null && !this.isFocusable(id)) return false;
      this.focusedElement = id;
      this.focusState = id == null ? FocusState.Unfocused : state;
      this.onChanged(previous, id, this.focusState);
      if (previous != null) this.router.raise(previous, 'LostFocus', { ...payload, NewFocusedElement: id });
      if (id != null) {
        this.focusElement(id, state);
        this.router.raise(id, 'GotFocus', { ...payload, NewFocusedElement: id });
      }
      return true;
    } finally { this.changing = false; }
  }
  findNext(direction = 'Next', { searchRoot = null } = {}) {
    const current = this.focusedElement;
    const order = tabOrder(this.nodes, searchRoot == null ? this.roots() : [searchRoot], this.childrenOf, { current, isTabStop: this.isTabStop });
    if (['Next', 'Previous'].includes(direction)) {
      let cycleRoot = searchRoot;
      let ancestor = current;
      while (ancestor != null && cycleRoot == null) {
        const mode = this.nodes.get(ancestor)?.properties?.TabFocusNavigation;
        if (mode === 1 || mode === 'Cycle') cycleRoot = ancestor;
        ancestor = this.parentOf(ancestor);
      }
      const scopeOrder = cycleRoot == null ? order : tabOrder(this.nodes, [cycleRoot], this.childrenOf, { current, isTabStop: this.isTabStop });
      return nextTabStop(scopeOrder, current, direction === 'Previous', cycleRoot != null);
    }
    const properties = this.nodes.get(current)?.properties ?? {};
    const explicit = properties['XYFocus' + direction]?.$ref ?? properties['XYFocus' + direction];
    if (explicit && this.isFocusable(explicit)) return explicit;
    const bounds = this.layoutFor(current)?.bounds;
    return bounds ? findDirectionalFocus(bounds, order.filter(id => id !== current).map(id => ({ id, bounds: this.layoutFor(id)?.bounds }))
      .filter(candidate => candidate.bounds), direction) : order[0] ?? null;
  }
  tryMoveFocus(direction, options) {
    const next = this.findNext(direction, options);
    if (next == null) {
      if (this.focusedElement) this.router.raise(this.focusedElement, 'NoFocusCandidateFound', { Direction: direction });
      return false;
    }
    return this.focus(next, FocusState.Keyboard, direction);
  }
  async tryFocusAsync(id, state = FocusState.Programmatic, { signal } = {}) {
    signal?.throwIfAborted();
    return { Succeeded: this.focus(id, state) };
  }
  removeNode(id) { if (this.focusedElement === id) this.focus(null); }
  dispose() { if (!this.disposed) this.focus(null); this.disposed = true; }
}
