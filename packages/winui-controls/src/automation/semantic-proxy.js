import { PatternInterface } from './enums.js';
import { inverseMatrix, multiplyMatrix, identityMatrix } from '../layout/render-properties.js';

const editors = 'input,textarea,select,[contenteditable="true"]';

/** Transparent semantic mirrors retain real bounds; native editors keep their own accessible element. */
export class SemanticProxyTree {
  constructor(tree) {
    this.tree = tree;
    this.layer = tree.host.document.createElement('div');
    this.layer.dataset.sfAutomationProxies = '';
    Object.assign(this.layer.style, { position: 'absolute', left: '0px', top: '0px', width: '100%', height: '100%',
      opacity: '0', pointerEvents: 'none' });
    this.proxies = new Map();
    this.sources = new Map();
    this.active = new Set();
    this.onFocus = event => {
      const id = event.target.dataset.sfProxyId;
      if (id) tree.host.focusManager?.focus(id, 2);
    };
    this.onKey = event => {
      const id = event.target.dataset.sfProxyId;
      const peer = id && tree.getPeer(id);
      if (peer && activateProxy(peer, event)) event.preventDefault();
    };
    this.layer.addEventListener('focusin', this.onFocus);
    this.layer.addEventListener('keydown', this.onKey);
  }
  begin() { this.active.clear(); }
  supports(element, peer) {
    return !element?.matches?.(editors) && !element?.querySelector?.(editors + ',button,a[href],[role="button"]')
      && !peer.GetPattern(PatternInterface.Text) && !peer.IsPassword();
  }
  update(peer, layout, source) {
    if (!layout || !this.supports(source, peer)) return null;
    let element = this.proxies.get(peer.id);
    if (!element) {
      element = this.tree.host.document.createElement('div');
      element.dataset.sfProxyId = peer.id;
      this.proxies.set(peer.id, element);
    }
    this.active.add(peer.id);
    this.tree.bridge.apply(peer, element, { proxy: true });
    const content = peer.GetName();
    if (element.textContent !== content) element.textContent = content;
    Object.assign(element.style, { position: 'absolute', left: '0px', top: '0px', transformOrigin: '0 0',
      width: layout.renderSize.width + 'px', height: layout.renderSize.height + 'px' });
    this.hideSource(peer.id, source);
    return element;
  }
  hideSource(id, source) {
    if (!source) return;
    if (this.sources.get(id)?.source !== source) {
      this.restoreSource(id);
      this.sources.set(id, { source, hidden: source.getAttribute('aria-hidden'), tabIndex: source.getAttribute('tabindex'), id: source.getAttribute('id') });
    }
    source.removeAttribute('id');
    source.setAttribute('aria-hidden', 'true');
    source.tabIndex = -1;
  }
  end() {
    for (const id of this.proxies.keys()) if (!this.active.has(id)) this.remove(id);
    for (const id of this.active) {
      const element = this.proxies.get(id);
      const layout = this.tree.host.getLayout(id);
      let parentId = layout.parentId;
      while (parentId && !this.active.has(parentId)) parentId = this.tree.host.parentOf(parentId);
      const parent = parentId ? this.proxies.get(parentId) : this.layer;
      const parentWorld = parentId ? this.tree.host.getLayout(parentId)?.worldTransform : identityMatrix;
      const inverse = inverseMatrix(parentWorld ?? identityMatrix);
      const transform = inverse ? multiplyMatrix(inverse, layout.worldTransform) : layout.worldTransform;
      element.style.transform = 'matrix(' + transform.join(',') + ')';
      if (element.parentElement !== parent) parent.append(element);
    }
  }
  restoreSource(id) {
    const previous = this.sources.get(id);
    if (!previous) return;
    for (const [name, value] of [['aria-hidden', previous.hidden], ['tabindex', previous.tabIndex], ['id', previous.id]]) {
      if (value == null) previous.source.removeAttribute(name);
      else previous.source.setAttribute(name, value);
    }
    this.sources.delete(id);
  }
  remove(id) {
    const element = this.proxies.get(id);
    if (element) this.tree.bridge.remove(element);
    element?.remove();
    this.proxies.delete(id);
    this.restoreSource(id);
  }
  dispose() {
    for (const id of this.proxies.keys()) this.remove(id);
    this.layer.removeEventListener('focusin', this.onFocus);
    this.layer.removeEventListener('keydown', this.onKey);
    this.layer.remove();
    this.active.clear();
  }
}

function activateProxy(peer, event) {
  if (event.altKey || event.ctrlKey || event.metaKey || !peer.IsEnabled()) return false;
  const range = peer.GetPattern(PatternInterface.RangeValue);
  if (range && !range.IsReadOnly && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
    const deltas = { ArrowLeft: -range.SmallChange, ArrowDown: -range.SmallChange, ArrowRight: range.SmallChange,
      ArrowUp: range.SmallChange, PageUp: range.LargeChange, PageDown: -range.LargeChange };
    const value = event.key === 'Home' ? range.Minimum : event.key === 'End' ? range.Maximum : range.Value + deltas[event.key];
    range.SetValue(Math.min(range.Maximum, Math.max(range.Minimum, value)));
    return true;
  }
  if (!['Enter', ' '].includes(event.key) || event.repeat) return false;
  for (const [pattern, method] of [[PatternInterface.Invoke, 'Invoke'], [PatternInterface.Toggle, 'Toggle'],
    [PatternInterface.SelectionItem, 'Select']]) {
    const provider = peer.GetPattern(pattern);
    if (provider) { provider[method](); return true; }
  }
  const expand = peer.GetPattern(PatternInterface.ExpandCollapse);
  if (expand) { if (expand.ExpandCollapseState === 1) expand.Collapse(); else expand.Expand(); return true; }
  return false;
}
