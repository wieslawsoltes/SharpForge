import { prepareDocumentClose, assertUnchanged } from './close-flow.js';
export { confirmDirtyDocuments } from './close-dialog.js';

export const sourcePanelId = uri => `source:${uri}`;

function validateDocumentUri(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 8192) throw new TypeError('Invalid document URI');
}

/** Document tab policy over DockLayout; DocumentService owns buffers and saving. No editor instance is serialized. */
export class DocumentTabs {
  constructor({ layout, documents, confirmClose, onActivate = () => {}, onClosed = () => {}, closedLimit = 50 } = {}) {
    if (!layout || !documents) throw new TypeError('DocumentTabs needs a layout and document service');
    this.layout = layout;
    this.documents = documents;
    this.confirmClose = confirmClose;
    this.onActivate = onActivate;
    this.onClosed = onClosed;
    this.closedLimit = closedLimit;
    this.closed = [];
    this.views = new Map();
    this.mru = [];
    this.serial = 0;
    this.closing = null;
    this.openQueue = Promise.resolve();
    this.openGeneration = 0;
    this.observedActivePanel = layout.state.activePanel;
    this.admissionTarget = null;
    this.disposed = false;
    this.controller = new AbortController();
    this.unsubscribe = documents.subscribe?.(event => this.documentChanged(event));
    this.offLayout = layout.subscribe(event => {
      const active = layout.state.activePanel;
      if (active !== this.observedActivePanel) {
        this.observedActivePanel = active;
        if (this.admissionTarget === null || active !== this.admissionTarget) this.openGeneration++;
      }
      if (event.type === 'activate') this.recordActivation(active);
    });
  }

  metadata(id) {
    return this.views.get(id) ?? this.layout.state.documentViews?.[id]
      ?? (id?.startsWith('source:') ? { uri: id.slice(7), viewId: 'primary' } : null);
  }

  panel(uri, viewId = 'primary') {
    if (viewId === 'primary') return sourcePanelId(uri);
    return [...this.views].find(([, view]) => view.uri === uri && view.viewId === viewId)?.[0] ?? null;
  }

  ensure(uri, viewId = 'primary') {
    validateDocumentUri(uri);
    let id = this.panel(uri, viewId);
    if (!id) {
      do { id = `document-view:${++this.serial}:${uri}`; } while (this.layout.panels.has(id));
    }
    this.views.set(id, { uri, viewId });
    this.layout.state.documentViews ??= {};
    this.layout.state.documentViews[id] = { uri, viewId };
    if (!this.layout.panels.has(id)) {
      this.layout.register({ id, kind: 'document', title: `${uri.split('/').at(-1)}${viewId === 'primary' ? '' : ` · ${viewId}`}`,
        description: uri, documentUri: uri, viewId });
    }
    return id;
  }

  list({ groupId = null } = {}) {
    const groups = this.layout.groups().filter(group => !groupId || group.id === groupId);
    return groups.flatMap(group => group.panels).filter(id => this.metadata(id) && this.layout.require(id).kind === 'document');
  }

  /** Keep one guarded request current through queued admission and its caller's final activation. */
  createOpenAdmission({signal, isCurrent = () => true} = {}) {
    const generation = ++this.openGeneration;
    const current = () => !this.disposed && !signal?.aborted && generation === this.openGeneration && isCurrent();
    const admission = {
      owner: this, signal, isCurrent: current,
      activate: id => {
        if (!current()) return false;
        const previous = this.admissionTarget;
        this.admissionTarget = id;
        try { return this.activate(id, {admission}); }
        finally { this.admissionTarget = previous; }
      }
    };
    return Object.freeze(admission);
  }

  open(uri, options = {}) {
    if (options.admission && options.admission.owner !== this) throw new TypeError('Document admission belongs to another tab service');
    if (!options.admission) this.openGeneration++;
    const operation = this.openQueue.then(() => this.openNow(uri, options));
    this.openQueue = operation.catch(() => {});
    return operation;
  }

  async openNow(uri, {
    preview = false, pinned = false, groupId = null, viewId = 'primary', viewState = null,
    activate = true, signal, admission
  } = {}) {
    if (this.disposed) throw new Error('Document tabs have been disposed');
    validateDocumentUri(uri);
    const current = () => !this.disposed && !signal?.aborted && (!admission || admission.isCurrent());
    if (!current()) return null;
    if (groupId && !this.layout.group(groupId)) throw new Error('Unknown document group');
    const record = await this.documents.open(uri, { activate: false, viewId, signal: signal ?? admission?.signal });
    if (!current()) return null;
    const id = this.ensure(uri, viewId);
    const wasOpen = this.layout.locate(id).kind !== 'closed';
    const target = groupId ? this.layout.group(groupId) : this.layout.groups().find(group => group.kind === 'document');
    if (groupId && !target) throw new Error('Unknown document group');
    if (preview && !wasOpen && target) {
      const replace = target.panels.filter(item => this.layout.state.tabState[item]?.preview && item !== id);
      for (const oldId of replace) {
        const old = this.metadata(oldId);
        if (this.documents.get(old.uri)?.dirty) this.promote(oldId);
        else await this.closeMany([oldId], { remember: false });
        if (!current()) return null;
      }
    }
    if (!current()) return null;
    this.layout.transaction('openDocument', () => {
      if (!wasOpen) this.layout.setTabState(id, { pinned: Boolean(pinned), preview: Boolean(preview && !pinned && !record?.dirty) });
      else if (pinned) this.layout.setTabState(id, { pinned: true, preview: false });
      this.layout.open(id, target?.id, { activate: activate && !admission });
    });
    if (!current()) return null;
    if (viewState) this.documents.restoreViewState(uri, viewState, viewId);
    if (activate) {
      if (admission) admission.activate(id);
      else this.activate(id);
    }
    return id;
  }

  activate(id, {admission} = {}) {
    const view = this.metadata(id);
    if (!view || admission && !admission.isCurrent()) return false;
    this.layout.activate(id);
    if (admission && !admission.isCurrent()) return false;
    this.documents.activate?.(view.uri, { viewId: view.viewId });
    if (admission && !admission.isCurrent()) return false;
    this.recordActivation(id);
    this.onActivate(id, view);
    return !admission || admission.isCurrent();
  }

  recordActivation(id) {
    if (!this.metadata(id)) return;
    this.mru = [id, ...this.mru.filter(item => item !== id)].slice(0, 8192);
  }

  promote(id) {
    if (!this.metadata(id) || !this.layout.panels.has(id)) return false;
    return this.layout.setTabState(id, { preview: false });
  }

  pin(id, pinned = true) {
    return this.layout.setTabState(id, { pinned: Boolean(pinned), preview: false });
  }

  documentChanged(event) {
    if (!['changed', 'dirty', 'saved'].includes(event.type)) return;
    const dirty = Boolean(this.documents.get(event.uri)?.dirty);
    let metadataChanged = false;
    const previews = [];
    for (const [id, view] of this.views) {
      if (view.uri !== event.uri || !this.layout.panels.has(id)) continue;
      const panel = this.layout.require(id);
      if (Boolean(panel.dirty) !== dirty) {
        panel.dirty = dirty;
        metadataChanged = true;
      }
      if (dirty && this.layout.state.tabState[id]?.preview) previews.push(id);
    }
    if (previews.length) {
      this.layout.transaction('documentState', () => {
        for (const id of previews) this.layout.setTabState(id, { preview: false });
      });
    } else if (metadataChanged) {
      this.layout.notify('documentState');
    }
  }

  close(id) { return this.closeMany([id]); }

  closeVariant(id, variant) {
    const group = this.layout.locate(id).group;
    const all = this.list();
    const pinned = item => this.layout.state.tabState[item]?.pinned;
    const variants = {
      all: () => all,
      others: () => all.filter(item => item !== id && !pinned(item)),
      unpinned: () => all.filter(item => !pinned(item)),
      right: () => (group?.panels.slice(group.panels.indexOf(id) + 1) ?? []).filter(item => this.metadata(item) && !pinned(item))
    };
    if (!variants[variant]) throw new Error('Unknown close variant');
    return this.closeMany(variants[variant]());
  }

  closeMany(ids, options = {}) {
    if (this.closing) return this.closing;
    const unique = [...new Set(ids)].filter(id => this.metadata(id) && this.layout.panels.has(id) && this.layout.locate(id).kind !== 'closed');
    this.closing = this.performClose(unique, options).finally(() => { this.closing = null; });
    return this.closing;
  }

  async performClose(ids, { remember = true } = {}) {
    if (!ids.length) return true;
    const closing = new Set(ids);
    const retainedUris = new Set(this.list().filter(id => !closing.has(id)).map(id => this.metadata(id).uri));
    const uris = ids.map(id => this.metadata(id).uri).filter(uri => !retainedUris.has(uri));
    const plan = await prepareDocumentClose(this.documents, uris, this.confirmClose, { signal: this.controller.signal });
    if (!plan || this.disposed) return false;
    const records = ids.map(id => {
      const view = this.metadata(id);
      const location = this.layout.locate(id);
      return { id, ...view, groupId: location.group?.id, index: location.index,
        tabState: { ...this.layout.state.tabState[id] }, viewState: this.documents.getViewState?.(view.uri, view.viewId) ?? null };
    });
    const snapshot = this.layout.snapshot();
    const serviceTabs = this.documents.tabs ? [...this.documents.tabs] : null;
    try {
      for (const uri of plan.uris) assertUnchanged(this.documents.get(uri), plan.revisions.get(uri), uri);
      for (const uri of plan.uris) await this.documents.close(uri, { discard: plan.decisions.get(uri) === 'discard' });
      this.layout.transaction('closeDocuments', () => { for (const id of ids) this.layout.close(id); });
    } catch (error) {
      for (const record of records) await this.documents.open(record.uri, { activate: false, viewId: record.viewId });
      if (serviceTabs) this.documents.setTabs?.(serviceTabs);
      this.layout.restore(snapshot);
      throw error;
    }
    for (const id of ids) this.onClosed(id);
    if (remember) this.closed.push(...records);
    if (this.closed.length > this.closedLimit) this.closed.splice(0, this.closed.length - this.closedLimit);
    this.mru = this.mru.filter(id => !closing.has(id));
    const next = this.mru.find(id => this.layout.locate(id).kind !== 'closed') ?? this.list()[0];
    if (next) this.activate(next);
    return true;
  }

  async saveAll(ids = this.list()) {
    const uris = [...new Set(ids.map(id => this.metadata(id)?.uri).filter(Boolean))];
    for (const uri of uris) {
      if (!this.documents.get(uri)?.dirty) continue;
      const result = await this.documents.save(uri, { signal: this.controller.signal });
      if (result === false || result?.ok === false || this.documents.get(uri)?.dirty) throw new Error(`Could not save ${uri}`);
    }
    return true;
  }

  async reopenClosed() {
    const entry = this.closed.at(-1);
    if (!entry) return null;
    const groupId = this.layout.group(entry.groupId)?.id;
    const id = await this.open(entry.uri, { viewId: entry.viewId, pinned: entry.tabState.pinned, groupId, viewState: entry.viewState });
    if (id) {
      this.closed.pop();
      if (groupId) this.layout.dock(id, groupId, 'center', entry.index);
    }
    return id;
  }

  split(id, axis = 'vertical', { groupId = null } = {}) {
    const group = groupId ? this.layout.group(groupId) : this.layout.locate(id).group;
    if (!group || !['horizontal', 'vertical'].includes(axis)) throw new Error('Invalid document group split');
    this.promote(id);
    return this.layout.dock(id, group.id, axis === 'vertical' ? 'right' : 'bottom');
  }

  moveGroup(id, direction) {
    const groups = this.layout.groups().filter(group => group.kind === 'document');
    const index = groups.findIndex(group => group.panels.includes(id));
    if (index < 0 || groups.length < 2) return false;
    const next = groups[(index + direction + groups.length) % groups.length];
    this.promote(id);
    return this.layout.dock(id, next.id);
  }

  async newView(id, { axis = 'vertical' } = {}) {
    const view = this.metadata(id);
    if (!view) throw new Error('No active document');
    if (!['horizontal', 'vertical'].includes(axis)) throw new Error('Invalid document group split');
    const groupId = this.layout.locate(id).group?.id;
    if (!groupId) throw new Error('No active document group');
    let viewId;
    do { viewId = `view-${++this.serial}`; } while (this.panel(view.uri, viewId));
    const next = await this.open(view.uri, { viewId, groupId,
      viewState: this.documents.getViewState?.(view.uri, view.viewId) ?? null });
    if (!next) return null;
    this.split(next, axis, { groupId });
    return next;
  }

  dispose() {
    this.disposed = true;
    this.controller.abort();
    this.unsubscribe?.();
    this.offLayout();
    this.views.clear();
    this.closed = [];
    this.mru = [];
  }
}
