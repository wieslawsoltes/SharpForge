import { panelIds } from '../model/nodes.js';
import { clampFloatingBounds } from '../model/schema.js';
import { DockGuideOverlay } from './guides.js';
import { createNodeView } from './groups.js';
import { openPopout, reattachPopout } from './popouts.js';
import { renderDockHost } from './render.js';
import { showDockMenu } from './menu.js';
import { moveFloating, pointerSession } from './pointer.js';
import { redockFloating } from './floating.js';

/** DOM docking adapter. Panel elements move without recreating editors, buffers or event listeners. */
export class DockHost {
  constructor(element, layout, options = {}) {
    const noop = () => {};
    this.element = element;
    this.layout = layout;
    this.resolveContent = options.resolveContent;
    this.onActivate = options.onActivate ?? noop;
    this.onError = options.onError ?? noop;
    this.onClose = options.onClose ?? noop;
    this.requestClose = options.requestClose ?? null;
    this.onWindowKeyDown = options.onWindowKeyDown ?? noop;
    this.onWindowFocus = options.onWindowFocus ?? noop;
    this.onPopoutDocument = options.onPopoutDocument ?? noop;
    this.onTabDoubleClick = options.onTabDoubleClick ?? null;
    this.menuProvider = options.menuProvider ?? null;
    this.contents = new Map();
    this.contentIds = new Map();
    this.popouts = new Map();
    this.pointerCancels = new Set();
    this.windowWatch = null;
    this.autoPanel = null;
    this.dragPanel = null;
    this.dragNode = null;
    this.disposed = false;
    this.controller = new AbortController();
    this.guides = new DockGuideOverlay(this);
    this.element.classList.add('sf-dock-host');
    this.unsubscribe = layout.subscribe(event => {
      if (!this.dragSizing || !['resize', 'bounds', 'flyoutSize'].includes(event.type)) this.render();
    });
    const document = element.ownerDocument;
    const signal = this.controller.signal;
    document.addEventListener('pointerdown', event => {
      if (!this.autoPanel || event.target.closest('.sf-dock-auto-popup,.sf-dock-shelf')) return;
      if (event.target.closest('[data-dock-toggle]')?.dataset.dockToggle === this.autoPanel) return;
      this.hideAutoPanel();
    }, { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.autoPanel) { event.preventDefault(); this.hideAutoPanel(); }
      if (event.key === 'Escape' && (this.dragPanel || this.dragNode)) {
        for (const cancel of [...this.pointerCancels]) cancel();
        this.clearDrag();
      }
    }, { signal });
    const Observer = document.defaultView.ResizeObserver;
    this.resizeObserver = Observer ? new Observer(() => this.updateOverflow()) : null;
    document.defaultView.addEventListener('resize', () => this.clampWindows(), { signal });
    this.render();
  }

  escape(value) { return this.element.ownerDocument.defaultView.CSS?.escape(value) ?? value.replace(/["\\]/g, '\\$&'); }
  el(tag, className, text) {
    const element = this.element.ownerDocument.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  contentId(id) {
    if (!this.contentIds.has(id)) this.contentIds.set(id, `sf-dock-content-${this.contentIds.size + 1}`);
    return this.contentIds.get(id);
  }

  content(id) {
    let content = this.contents.get(id);
    if (!content) {
      content = this.resolveContent?.(id) ?? this.el('div', '', '');
      content.dataset.dockPanel = id;
      content.id ||= this.contentId(id);
      this.contentIds.set(id, content.id);
      content.setAttribute('role', 'tabpanel');
      content.setAttribute('aria-label', this.layout.require(id).title);
      content.classList.add('sf-dock-panel');
      content.addEventListener('focusin', () => {
        if (this.rendering || this.layout.state.activePanel === id || !this.layout.panels.has(id)) return;
        this.layout.activate(id);
        this.onActivate(id);
      }, { signal: this.controller.signal });
      this.contents.set(id, content);
    }
    return content;
  }

  attempt(action) {
    try {
      const result = action();
      if (result?.then) return result.catch(error => { this.onError(error); return false; });
      return result;
    } catch (error) { this.onError(error); return false; }
  }

  button(label, title, action) {
    const button = this.el('button', 'sf-dock-button', label);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.onclick = event => { event.stopPropagation(); this.attempt(action); };
    return button;
  }

  render() { renderDockHost(this); }
  node(node) { return createNodeView(this, node); }
  ids(node) { return panelIds(node); }
  mainGroup() { return this.layout.groups().find(group => group.kind === 'document')?.id ?? this.layout.groups()[0]?.id; }
  clamp(bounds) { return clampFloatingBounds(bounds, { width: this.element.clientWidth, height: this.element.clientHeight }); }

  clampWindows() {
    if (!this.layout.state.floating.length) return;
    this.layout.transaction('monitorChange', () => {
      for (const floating of this.layout.state.floating) this.layout.bounds(floating.id, this.clamp(floating), { history: false });
    }, { history: false });
  }

  focusTab(id) { this.element.querySelector(`[data-dock-tab="${this.escape(id)}"]`)?.focus({ preventScroll: true }); }
  focusPanel(id) {
    const popout = this.popouts.get(id);
    if (popout) { popout.window.focus(); return true; }
    const where = this.layout.locate(id);
    if (where.kind === 'autoHide') this.showAutoPanel(id, true);
    else { this.layout.open(id); this.onActivate(id); }
    const target = this.content(id).querySelector('textarea,input,[contenteditable="true"],[tabindex="0"]');
    if (target) target.focus({ preventScroll: true });
    else this.focusTab(id);
    return true;
  }

  closePanel(id) {
    if (this.requestClose) return this.requestClose(id);
    this.layout.close(id);
    this.onClose(id);
    return true;
  }

  showAutoPanel(id, focus = false) {
    this.clearFlyoutTimers();
    if (this.layout.locate(id).kind !== 'autoHide') return;
    this.autoPanel = id;
    this.layout.activate(id);
    this.render();
    if (focus) this.content(id).querySelector('input,textarea,button,[tabindex="0"]')?.focus({ preventScroll: true });
    this.onActivate(id);
  }

  hideAutoPanel() { this.clearFlyoutTimers(); this.autoPanel = null; this.render(); }
  clearFlyoutTimers() { clearTimeout(this.flyoutOpenTimer); clearTimeout(this.flyoutCloseTimer); }
  scheduleFlyoutClose() {
    this.clearFlyoutTimers();
    this.flyoutCloseTimer = setTimeout(() => {
      const popup = this.element.querySelector('.sf-dock-auto-popup');
      if (!popup?.contains(this.element.ownerDocument.activeElement)) this.hideAutoPanel();
    }, 350);
  }

  acceptsDrag(event) {
    return Boolean(this.dragPanel || this.dragNode || event.dataTransfer?.types?.includes('application/x-sharpforge-panel'));
  }

  readDrag(event) {
    const id = event.dataTransfer?.getData('application/x-sharpforge-panel');
    if (id && this.layout.panels.has(id)) this.dragPanel = id;
  }

  groupAt(x, y, exclude = null) {
    const groups = [...this.element.querySelectorAll('[data-dock-group]')].filter(group => !exclude?.contains(group));
    return groups.reverse().find(group => {
      const bounds = group.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    });
  }

  dropDrag(target, groupId) {
    const panel = this.dragPanel;
    const node = this.dragNode;
    const result = this.attempt(() => {
      if (node) return this.layout.dockGroup(node, groupId, target.side, { root: target.scope === 'root' });
      if (!panel) return false;
      if (target.scope === 'root') return this.layout.dockRoot(panel, target.side);
      return this.layout.dock(panel, groupId, target.side);
    });
    this.clearDrag();
    return result;
  }

  clearDrag() {
    this.dragPanel = null;
    this.dragNode = null;
    this.element.classList.remove('sf-dock-dragging');
    for (const tab of this.element.querySelectorAll('.drop-before')) tab.classList.remove('drop-before');
    this.guides.clear();
  }

  updateOverflow() {
    for (const tabs of this.element.querySelectorAll('.sf-dock-tabs')) {
      const overflow = tabs.scrollWidth > tabs.clientWidth + 1;
      for (const button of tabs.parentElement.querySelectorAll('.sf-dock-scroll')) button.hidden = !overflow;
    }
  }

  toggleFloat(id) {
    const location = this.layout.locate(id);
    if (location.floatingId) return redockFloating(this, this.layout.state.floating.find(item => item.id === location.floatingId));
    return this.layout.float(id);
  }

  pointerSession(event, target, move, end) { return pointerSession(this, event, target, move, end); }
  moveFloating(event, floating, element, resize = false) { return moveFloating(this, event, floating, element, resize); }
  showMenu(items, x, y, options) { return showDockMenu(this, items, x, y, options); }

  menu(id, x, y) {
    const supplied = this.menuProvider?.(id);
    if (supplied) return this.showMenu(supplied, x, y);
    const items = [
      { title: 'Float in workspace', execute: () => this.layout.float(id) },
      { title: 'Float entire tab group', execute: () => this.layout.floatGroup(this.layout.locate(id).group.id),
        enabled: Boolean(this.layout.locate(id).group) },
      { title: 'Open separate browser window', execute: () => this.popout(id) }
    ];
    for (const side of ['left', 'right', 'top', 'bottom']) items.push({ title: `Dock ${side}`, execute: () => this.layout.dockRoot(id, side) });
    if (this.layout.require(id).kind === 'tool') {
      items.push({ title: 'Pin to previous position', execute: () => this.layout.pin(id), enabled: this.layout.locate(id).kind === 'autoHide' });
      for (const side of ['left', 'right', 'top', 'bottom']) items.push({ title: `Auto-hide ${side}`, execute: () => this.layout.autoHide(id, side) });
    }
    items.push({ title: 'Close', enabled: this.layout.require(id).closable, execute: () => this.closePanel(id) });
    return this.showMenu(items, x, y);
  }

  popout(id) { return openPopout(this, id); }
  reattachClosedPopout(id) { return reattachPopout(this, id); }
  /** Returns retained content; render:false delegates rendering to the caller's completed layout transaction. */
  returnPopout(id, options = {}) { return reattachPopout(this, id, { close: true, ...options }); }
  maximize(groupId = null) { this.maximizedGroup = this.maximizedGroup ? null : groupId ?? this.mainGroup(); this.render(); }

  dispose() {
    if (this.disposed) return;
    for (const cancel of [...this.pointerCancels]) cancel();
    for (const id of [...this.popouts.keys()]) this.returnPopout(id);
    this.disposed = true;
    this.clearFlyoutTimers();
    if (this.windowWatch !== null) clearInterval(this.windowWatch);
    this.windowWatch = null;
    this.unsubscribe();
    this.controller.abort();
    this.resizeObserver?.disconnect();
    this.dismissMenu?.();
    this.guides.clear();
  }
}
