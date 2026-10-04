/** Connects synchronous Studio file activation to the docking service's one shared navigation history. */
export class StudioNavigation {
  constructor({ docking, getEditor, onChanged = () => {}, prepareDocument }) {
    if (!docking?.navigation || typeof getEditor !== 'function' || typeof onChanged !== 'function') {
      throw new TypeError('Studio navigation needs docking navigation and an active editor accessor');
    }
    this.docking = docking;
    this.navigation = docking.navigation;
    this.getEditor = getEditor;
    this.pending = new Map();
    this.disposed = false;
    this.releasePreparation = prepareDocument === undefined ? null : this.navigation.registerDocumentPreparation(prepareDocument);
    this.unsubscribe = this.navigation.subscribe(onChanged);
  }

  get history() { return this.navigation.history; }
  get canBack() { return this.history.canBack; }
  get canForward() { return this.history.canForward; }
  snapshot() { return this.history.snapshot(); }

  /** Capture the focused editor even when a newly activated dock tab has not installed its editor yet. */
  capture() {
    const { tabs, layout } = this.docking;
    const editor = this.getEditor();
    let panelId = layout.state.activePanel;
    if (editor) {
      const entry = [...tabs.views].find(([, view]) =>
        tabs.documents.views?.get(view.uri)?.get(view.viewId)?.editor === editor);
      if (entry) panelId = entry[0];
    }
    const location = this.navigation.capture(panelId);
    if (!location) return null;
    const viewEditor = tabs.documents.views?.get(location.uri)?.get(location.viewId)?.editor;
    if (!editor || viewEditor !== editor) return location;
    const first = editor.input?.selectionStart ?? editor.offset ?? location.start;
    const last = editor.input?.selectionEnd ?? first;
    return { ...location, start: Math.min(first, last), end: Math.max(first, last),
      scrollTop: editor.input?.scrollTop ?? location.scrollTop,
      scrollLeft: editor.input?.scrollLeft ?? location.scrollLeft };
  }

  /** Pair with afterJump in finally. Nested dock activation and history replay never add extra entries. */
  beforeOpen({ uri, offset = null, view = {} }) {
    if (this.disposed) throw new Error('Studio navigation is disposed');
    if (typeof uri !== 'string' || !uri || offset !== null && (!Number.isSafeInteger(offset) || offset < 0)) {
      throw new TypeError('Invalid navigation target');
    }
    const current = this.capture();
    const viewId = view.viewId ?? this.docking.tabs.metadata(view.panelId)?.viewId ?? 'primary';
    const record = !this.navigation.replaying && this.pending.size === 0
      && (!current || current.uri !== uri || current.viewId !== viewId || offset !== null);
    const token = Object.freeze({});
    this.pending.set(token, record);
    if (record && current) this.navigation.update(current);
    return token;
  }

  /** Pass record:false if opening failed; the departure position remains valid and no target is added. */
  afterJump(token, { record = true } = {}) {
    const shouldRecord = this.pending.get(token);
    if (!this.pending.delete(token)) return false;
    if (!record || !shouldRecord || this.pending.size || this.navigation.replaying || this.disposed) return false;
    const location = this.capture();
    if (!location) return false;
    this.navigation.record(location);
    return true;
  }

  back() { return this.navigation.back(); }
  forward() { return this.navigation.forward(); }
  menu(x, y) { return this.navigation.menu(x, y); }
  clear() { this.pending.clear(); this.navigation.clear(); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.unsubscribe();
    this.releasePreparation?.();
  }
}
