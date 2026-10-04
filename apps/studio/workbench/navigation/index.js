import { WorkbenchNavigationHistory } from '../navigation-history.js';
import { createWorkspaceNavigation } from '../../workspace-navigation.js';

/** Replays locations in their original group, recreating a group through explicit docking when it has collapsed. */
export class WorkbenchNavigation {
  constructor({ tabs, host, history = new WorkbenchNavigationHistory(), onChanged = () => {} } = {}) {
    this.tabs = tabs;
    this.host = host;
    this.history = history;
    this.onChanged = onChanged;
    this.listeners = new Set();
    this.replaying = false;
    this.replayOwner = null;
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

  clear() {
    this.preparedReplay?.cancel();
    this.replayOwner = null;
    this.replaying = false;
    this.history.clear();
    this.changed();
  }

  /** One host owns lazy admission; all toolbar, shortcut and menu actions retain the same history. */
  registerDocumentPreparation(prepareDocument) {
    if (typeof prepareDocument !== 'function') throw new TypeError('Document preparation must be a function');
    if (this.preparedReplay) throw new Error('Navigation document preparation already has an owner');
    const replay = createWorkspaceNavigation({
      history: this.history,
      context: () => ({identity: this, disk: this.tabs.documents, records: this.history.entries}),
      currentLocation: () => this.capture(),
      prepareLocation: (location, options) => prepareDocument(location.uri, options),
      openLocation: (location, options) => this.replay(location, options),
      result: (_location, panelId) => panelId,
      setReplay: value => {
        this.replaying = value;
        if (!value) this.replayOwner = null;
      },
      renderButtons: () => this.changed()
    });
    this.preparedReplay = replay;
    return () => {
      if (this.preparedReplay !== replay) return;
      this.preparedReplay = null;
      replay.cancel();
    };
  }

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

  async replay(location, {signal, isCurrent = () => true} = {}) {
    if (!location) return null;
    const owner = {};
    this.replayOwner = owner;
    const admission = this.tabs.createOpenAdmission({signal,
      isCurrent: () => this.replayOwner === owner && isCurrent()});
    const current = admission.isCurrent;
    try {
      if (!current()) return null;
      let groupId = this.tabs.layout.group(location.groupId)?.id;
      const id = await this.tabs.open(location.uri, {
        groupId, viewId: location.viewId, activate: false, admission
      });
      if (!id || !current()) return null;
      this.replaying = true;
      if (!admission.activate(id)) return null;
      if (!current()) return null;
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
      if (!current()) return null;
      const popout = this.host.popouts.get(id);
      if (location.windowId !== 'main' && popout?.identity === location.windowId) popout.window.focus();
      else this.host.focusPanel(id);
      this.changed();
      return id;
    } finally {
      if (this.replayOwner === owner) {
        this.replaying = false;
        this.replayOwner = null;
      }
    }
  }

  back() { return this.preparedReplay ? this.preparedReplay.navigate('back') : this.replay(this.history.back(this.capture())); }
  forward() { return this.preparedReplay ? this.preparedReplay.navigate('forward') : this.replay(this.history.forward(this.capture())); }
  go(index) { return this.preparedReplay ? this.preparedReplay.go(index) : this.replay(this.history.go(index)); }
  menu(x, y) {
    const items = this.history.entries.map((entry, index) => ({
      id: `navigate:${index}`, title: `${entry.uri} · ${entry.start + 1}${entry.groupId ? ` · ${entry.groupId}` : ''}`,
      checked: index === this.history.index, execute: () => this.go(index)
    })).reverse();
    return this.host.showMenu(items, x, y, { label: 'Navigation history' });
  }
}
