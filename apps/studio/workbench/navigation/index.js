import { WorkbenchNavigationHistory } from '../navigation-history.js';

/** Replays locations in their original group, recreating a group through explicit docking when it has collapsed. */
export class WorkbenchNavigation {
  constructor({ tabs, host, history = new WorkbenchNavigationHistory(), onChanged = () => {} } = {}) {
    this.tabs = tabs;
    this.host = host;
    this.history = history;
    this.onChanged = onChanged;
    this.listeners = new Set();
    this.replaying = false;
  }

  /** Subscribe to the shared history used by toolbar, menu and direct window shortcuts. */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Navigation listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed() {
    const snapshot = this.history.snapshot();
    this.onChanged(snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }

  update(location = this.capture()) {
    if (!this.replaying && location) { this.history.update(location); this.changed(); }
  }

  clear() { this.history.clear(); this.changed(); }

  capture(id = this.tabs.layout.state.activePanel) {
    const view = this.tabs.metadata(id);
    if (!view) return null;
    const state = this.tabs.documents.getViewState?.(view.uri, view.viewId) ?? {};
    const start = state.start ?? state.selectionStart ?? state.selection?.start ?? 0;
    const end = state.end ?? state.selectionEnd ?? state.selection?.end ?? start;
    return { ...view, start, end, scrollTop: state.scrollTop ?? 0, scrollLeft: state.scrollLeft ?? 0,
      groupId: this.tabs.layout.locate(id).group?.id ?? null, windowId: this.host.popouts.get(id)?.identity ?? 'main' };
  }

  record(location = this.capture()) {
    if (!this.replaying && location) { this.history.push(location); this.changed(); }
  }

  async replay(location) {
    if (!location) return null;
    this.replaying = true;
    try {
      let groupId = this.tabs.layout.group(location.groupId)?.id;
      const id = await this.tabs.open(location.uri, { groupId, viewId: location.viewId });
      if (!id) return null;
      if (location.groupId && !groupId) {
        const group = this.tabs.layout.locate(id).group;
        if (group && group.panels.length > 1) this.tabs.split(id, 'vertical');
        const target = this.tabs.layout.locate(id).group;
        if (target && !this.tabs.layout.node(location.groupId)) {
          this.tabs.layout.change('navigationGroup', () => { target.id = location.groupId; });
        }
        groupId = target?.id;
      } else if (groupId && this.tabs.layout.locate(id).group?.id !== groupId) this.tabs.layout.dock(id, groupId);
      this.tabs.documents.restoreViewState?.(location.uri, {
        start: location.start, end: location.end, selectionStart: location.start, selectionEnd: location.end,
        scrollTop: location.scrollTop, scrollLeft: location.scrollLeft
      }, location.viewId);
      const popout = this.host.popouts.get(id);
      if (location.windowId !== 'main' && popout?.identity === location.windowId) popout.window.focus();
      else this.host.focusPanel(id);
      this.changed();
      return id;
    } finally { this.replaying = false; }
  }

  back() { return this.replay(this.history.back(this.capture())); }
  forward() { return this.replay(this.history.forward(this.capture())); }
  go(index) { return this.replay(this.history.go(index)); }
  menu(x, y) {
    const items = this.history.entries.map((entry, index) => ({
      id: `navigate:${index}`, title: `${entry.uri} · ${entry.start + 1}${entry.groupId ? ` · ${entry.groupId}` : ''}`,
      checked: index === this.history.index, execute: () => this.go(index)
    })).reverse();
    return this.host.showMenu(items, x, y, { label: 'Navigation history' });
  }
}
