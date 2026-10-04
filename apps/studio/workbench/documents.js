import { WorkbenchEvents, requireIdentifier, workbenchError } from './state-events.js';
import { DocumentIngress, validateDocumentModel } from './documents-ingress.js';
import { captureDocumentSave, savedModelBaseline } from './documents-save.js';
import { captureDocumentState } from './documents-state.js';
import { reloadDocument } from './documents-reload.js';

/** Workspace documents own text and editors; prompt/tab placement policies belong to the host. */
export class DocumentService {
  constructor({ records = [], createEditor, createModel, modelFactory, saveDocument, coordinateSave, maxDocuments = 20_000 } = {}) {
    this.records = new Map();
    this.recordList = [];
    this.baselines = new Map();
    this.projectMembership = new Map();
    this.documentProjects = new Map();
    this.tabs = [];
    this.active = '';
    this.dirtyFiles = new Set();
    this.editors = new Map();
    this.views = new Map();
    this.viewStates = new Map();
    this.activeViews = new Map();
    this.models = new Map();
    this.modelSubscriptions = new Map();
    this.staleSaves = new Set();
    this.reloadChanges = new WeakSet();
    this.events = new WorkbenchEvents();
    this.revision = 0;
    this.disposed = false;
    this.createEditor = createEditor;
    this.modelFactory = createModel ?? modelFactory;
    this.saveDocument = saveDocument;
    this.coordinateSave = coordinateSave;
    this.maxDocuments = maxDocuments;
    this.replace(records, { discard: true });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  get files() { return this.recordList; }
  get(uri) {
    const found = this.records.get(uri);
    if (found) return found;
    const index = this.recordList.findIndex(record => (record.uri ?? record.path) === uri);
    return index < 0 ? null : this.adopt(this.recordList[index], { dirty: !!this.recordList[index].dirty }, index);
  }
  list() { return this.files; }

  require(uri) {
    if (this.disposed) throw workbenchError('DOCUMENTS_DISPOSED', 'Document service is disposed');
    const record = this.get(uri);
    if (!record) throw workbenchError('DOCUMENT_MISSING', `Document '${uri}' is not open in this workspace`);
    return record;
  }

  replace(records, { tabs = [], active = '', discard = false, preserveEditors = false,
    preserveDirty = false, documentStates = null, commitMetadata, signal } = {}) {
    if (this.disposed) throw workbenchError('DOCUMENTS_DISPOSED', 'Document service is disposed');
    if (commitMetadata !== undefined && typeof commitMetadata !== 'function') throw new TypeError('Invalid metadata commit contribution');
    if (!Array.isArray(records) || records.length > this.maxDocuments) throw new RangeError('Document limit exceeded');
    if (this.dirtyFiles.size && !discard && !preserveDirty) {
      throw workbenchError('DOCUMENT_DIRTY', 'Save or discard changed documents before replacing the workspace');
    }
    const staged = new DocumentIngress(this, { signal, preserveEditors, preserveDirty, documentStates }).prepare(records);
    try {
      if (!discard && [...this.dirtyFiles].some(uri => !staged.preserved.has(uri))) {
        throw workbenchError('DOCUMENT_DIRTY', 'Save or discard changed documents before replacing them');
      }
      if (!Array.isArray(tabs) || tabs.some(uri => !staged.records.has(uri)) || active && !staged.records.has(active)) {
        throw new TypeError('Invalid restored document tabs');
      }
      staged.prepareSavedState();
    } catch (error) { staged.reject(error); }
    const oldModels = new Map(this.models);
    const oldSubscriptions = [...this.modelSubscriptions.values()];
    const oldUris = [...this.records.keys()];
    this.records = staged.records;
    this.recordList = [...staged.records.values()];
    this.baselines = staged.baselines;
    this.modelSubscriptions.clear();
    for (const [uri, dispose] of staged.subscriptions) this.modelSubscriptions.set(uri, dispose);
    this.models.clear();
    for (const [uri, model] of staged.models) this.models.set(uri, model);
    this.dirtyFiles.clear();
    for (const record of staged.records.values()) if (record.dirty) this.dirtyFiles.add(record.uri);
    this.staleSaves.clear();
    for (const uri of staged.staleSaves) this.staleSaves.add(uri);
    this.tabs = [...new Set(tabs)];
    this.active = active || this.tabs[0] || '';
    if (this.active && !this.tabs.includes(this.active)) this.tabs.push(this.active);
    this.revision++;
    staged.commit();
    this.finishReplacement({ oldModels, oldSubscriptions, oldUris, preserveEditors, commitMetadata });
    return { committed: true, count: this.records.size };
  }

  add(value, options) { return this.adopt(value, options); }

  adopt(value, { dirty = false, signal } = {}, index = -1) {
    if (this.disposed) throw workbenchError('DOCUMENTS_DISPOSED', 'Document service is disposed');
    if (this.records.size >= this.maxDocuments) throw new RangeError('Document limit exceeded');
    const staged = new DocumentIngress(this, { signal }).prepare([value], { dirty });
    const record = staged.records.values().next().value;
    try {
      if (this.records.has(record.uri)) throw new TypeError(`Duplicate document '${record.uri}'`);
      staged.prepareSavedState();
    } catch (error) { staged.reject(error); }
    this.records.set(record.uri, record);
    if (index < 0) this.recordList.push(record); else this.recordList[index] = record;
    this.baselines.set(record.uri, staged.baselines.get(record.uri));
    if (dirty) this.dirtyFiles.add(record.uri);
    const model = staged.models.get(record.uri);
    if (model) {
      this.models.set(record.uri, model);
      this.modelSubscriptions.set(record.uri, staged.subscriptions.get(record.uri));
    }
    this.revision++;
    staged.commit();
    this.afterCommit([() => this.events.emit({ type: 'added', uri: record.uri, record, revision: this.revision })]);
    return record;
  }

  setTabs(uris) {
    for (const uri of uris) this.require(uri);
    this.tabs = [...new Set(uris)];
    if (this.active && !this.tabs.includes(this.active)) this.active = this.tabs.at(-1) ?? '';
    this.events.emit({ type: 'tabs', tabs: [...this.tabs], active: this.active });
  }

  open(uri, { activate = true, viewId = 'primary' } = {}) {
    const record = this.require(uri);
    if (!this.tabs.includes(uri)) {
      this.tabs.push(uri);
      this.events.emit({ type: 'opened', uri, record, viewId });
    }
    if (activate) this.activate(uri, { viewId });
    return record;
  }

  activate(uri, { viewId = 'primary' } = {}) {
    const record = this.require(uri);
    if (!this.tabs.includes(uri)) this.open(uri, { activate: false, viewId });
    this.active = uri;
    this.activeViews.set(uri, viewId);
    this.events.emit({ type: 'activated', uri, record, viewId });
    return record;
  }

  update(uri, text, { version, origin = null, changes = null } = {}) {
    const record = this.require(uri);
    if (typeof text !== 'string') throw new TypeError('Document text must be a string');
    if (version !== undefined && record.version !== version) throw workbenchError('DOCUMENT_STALE', 'Document version changed');
    const model = this.models.get(uri);
    if (model) {
      model.setValue(text, { source: 'document', expectedVersion: version ?? model.version, undoStop: true, origin });
      return record;
    }
    if (record.text === text) return record;
    const previous = record.text;
    record.text = text;
    record.version++;
    const wasDirty = this.dirtyFiles.has(uri);
    const dirty = this.baselines.get(uri) !== text;
    record.dirty = dirty;
    if (dirty) this.dirtyFiles.add(uri); else this.dirtyFiles.delete(uri);
    this.revision++;
    for (const view of this.views.get(uri)?.values() ?? []) {
      if (view.editor !== origin && view.editor.value !== text) view.editor.setValue(text);
    }
    this.events.emit({ type: 'changed', uri, record, previous, changes, origin, revision: this.revision });
    if (dirty !== wasDirty) this.events.emit({ type: 'dirty', uri, record, dirty });
    return record;
  }

  markSaved(uri, options = {}) {
    const record = this.require(uri);
    const model = this.models.get(uri);
    if (model) return this.markModelSaved(uri, model, record, options);
    const { version, text } = options;
    const baseline = text ?? record.text;
    if (version !== undefined && version !== record.version && text === undefined) return false;
    this.baselines.set(uri, baseline);
    record.dirty = record.text !== baseline;
    if (record.dirty) this.dirtyFiles.add(uri); else this.dirtyFiles.delete(uri);
    this.events.emit({ type: 'saved', uri, record, dirty: record.dirty });
    this.events.emit({ type: 'dirty', uri, record, dirty: record.dirty });
    return !record.dirty;
  }

  /** Capture immutable source/version for disk streaming; legacy providers may read the lazy text property. */
  captureSave(uri) { return captureDocumentSave(this.require(uri), this.models.get(uri)); }

  captureState(uri) { return captureDocumentState(this, uri); }

  /** Accept a bounded external source with exact ownership and a synchronous metadata commit before notifications. */
  reload(uri, text, options) { return reloadDocument(this, uri, text, options); }

  async save(uri) {
    const record = this.require(uri);
    if (!this.saveDocument && !this.coordinateSave) {
      throw workbenchError('DOCUMENT_SAVE_UNAVAILABLE', 'No document save provider is registered');
    }
    const editor = this.views.get(uri)?.get(this.activeViews.get(uri))?.editor ?? this.editors.get(uri);
    const isCurrent = () => !this.disposed && this.records.get(uri) === record;
    const capture = () => {
      if (!isCurrent()) throw workbenchError('DOCUMENT_SAVE_STALE', 'The document changed ownership during save preparation');
      return this.captureSave(uri);
    };
    const prepare = options => {
      capture();
      const pending = editor?.prepareSave?.(options);
      return pending && typeof pending.then === 'function' ? pending.then(capture) : capture();
    };
    let snapshot = this.captureSave(uri);
    let result;
    if (this.coordinateSave) {
      result = await this.coordinateSave({ snapshot, prepare, isCurrent });
      snapshot = result?.snapshot ?? snapshot;
    } else {
      const prepared = prepare();
      snapshot = prepared && typeof prepared.then === 'function' ? await prepared : prepared;
      result = await this.saveDocument(snapshot);
    }
    if (result === false || result?.ok === false) return false;
    if (!isCurrent()) return false;
    return this.markSaved(uri, snapshot);
  }

  close(uri, { discard = false } = {}) {
    const record = this.require(uri);
    if (this.dirtyFiles.has(uri) && !discard) throw workbenchError('DOCUMENT_DIRTY', `Document '${uri}' has unsaved changes`);
    if (discard && this.dirtyFiles.has(uri)) {
      const baseline = this.baselines.get(uri);
      if (baseline !== null && baseline !== undefined) this.update(uri, typeof baseline === 'string' ? baseline : baseline.text);
      this.markSaved(uri);
    }
    this.tabs = this.tabs.filter(tab => tab !== uri);
    this.releaseViews(uri);
    if (this.active === uri) this.active = this.tabs.at(-1) ?? '';
    this.events.emit({ type: 'closed', uri, record, active: this.active });
    return true;
  }

  setProjectMembership(projectId, uris) {
    requireIdentifier(projectId, 'Project id');
    const next = new Set(uris);
    for (const uri of next) requireIdentifier(uri, 'Document URI');
    const previous = this.projectMembership.get(projectId) ?? new Set();
    const affected = new Set([...previous, ...next]);
    for (const uri of previous) {
      const projects = this.documentProjects.get(uri);
      projects?.delete(projectId);
      if (!projects?.size) this.documentProjects.delete(uri);
    }
    for (const uri of next) {
      const projects = this.documentProjects.get(uri) ?? new Set();
      projects.add(projectId);
      this.documentProjects.set(uri, projects);
    }
    this.projectMembership.set(projectId, next);
    this.events.emit({ type: 'membership', projectId, uris: [...affected] });
  }

  projectsFor(uri) {
    return [...this.documentProjects.get(uri) ?? []];
  }

  attachEditor(uri, editor, { viewId = 'primary', element = editor.element } = {}) {
    this.require(uri);
    requireIdentifier(viewId, 'View id');
    const views = this.views.get(uri) ?? new Map();
    if (views.has(viewId) && views.get(viewId).editor !== editor) throw new Error('Document view already has an editor');
    views.set(viewId, { editor, element });
    this.views.set(uri, views);
    if (viewId === 'primary' || !this.editors.has(uri)) this.editors.set(uri, editor);
    this.setEditorModel(uri, editor);
    this.events.emit({ type: 'view', uri, viewId, editor });
    return element;
  }

  createDocument(uri, { viewId = 'primary' } = {}) {
    const record = this.require(uri);
    const existing = this.views.get(uri)?.get(viewId);
    if (existing) return existing.element;
    if (!this.createEditor) throw workbenchError('EDITOR_PROVIDER_MISSING', 'No editor factory is registered');
    let instance;
    const model = this.models.get(uri) ?? null;
    const created = this.createEditor(record, {
      viewId, model,
      onChange: model ? undefined : (text, changes) => this.update(uri, text, { origin: instance, changes }),
      onFocus: () => this.activate(uri, { viewId })
    });
    instance = created.editor ?? created;
    const element = created.element ?? instance.element;
    this.attachEditor(uri, instance, { viewId, element });
    if (!model) instance.setModel?.(uri, record.text);
    const saved = this.viewStates.get(uri)?.get(viewId);
    if (saved) this.restoreViewState(uri, saved, viewId);
    return element;
  }

  getViewState(uri, viewId = 'primary') {
    const editor = this.views.get(uri)?.get(viewId)?.editor;
    if (editor?.getViewState) return editor.getViewState();
    if (!editor) return this.viewStates.get(uri)?.get(viewId) ?? null;
    return {
      start: editor.input?.selectionStart ?? editor.offset ?? 0,
      end: editor.input?.selectionEnd ?? editor.offset ?? 0,
      selectionStart: editor.input?.selectionStart ?? editor.offset ?? 0,
      selectionEnd: editor.input?.selectionEnd ?? editor.offset ?? 0,
      scrollTop: editor.input?.scrollTop ?? 0,
      scrollLeft: editor.input?.scrollLeft ?? 0
    };
  }

  restoreViewState(uri, state, viewId = 'primary') {
    this.require(uri);
    const saved = this.viewStates.get(uri) ?? new Map();
    saved.set(viewId, { ...state });
    this.viewStates.set(uri, saved);
    const editor = this.views.get(uri)?.get(viewId)?.editor;
    if (!editor) return;
    if (editor.restoreViewState) editor.restoreViewState(state);
    else {
      const start = state.start ?? state.selectionStart ?? 0;
      const end = state.end ?? state.selectionEnd ?? start;
      editor.input?.setSelectionRange(start, end);
      if (editor.input) {
        editor.input.scrollTop = state.scrollTop ?? 0;
        editor.input.scrollLeft = state.scrollLeft ?? 0;
      }
    }
  }

  releaseViews(uri) {
    const effects = [];
    for (const [viewId, view] of this.views.get(uri) ?? []) {
      effects.push(() => {
        const saved = this.viewStates.get(uri) ?? new Map();
        saved.set(viewId, this.getViewState(uri, viewId));
        this.viewStates.set(uri, saved);
      });
      effects.push(() => view.editor.dispose?.());
    }
    try { this.afterCommit(effects); }
    finally {
      this.views.delete(uri);
      this.editors.delete(uri);
      this.activeViews.delete(uri);
    }
  }

  resetEditors() { this.afterCommit([...this.views.keys()].map(uri => () => this.releaseViews(uri))); }

  snapshot() {
    return { files: this.files.map(record => ({ ...record })), tabs: [...this.tabs], active: this.active, dirtyFiles: [...this.dirtyFiles] };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const effects = [() => this.resetEditors(), ...this.modelSubscriptions.values(),
      ...[...this.models.values()].map(model => () => model.dispose?.()), () => this.events.dispose()];
    this.modelSubscriptions.clear();
    this.models.clear();
    this.records.clear();
    this.recordList.length = 0;
    this.baselines.clear();
    this.dirtyFiles.clear();
    this.staleSaves.clear();
    this.documentProjects.clear();
    this.projectMembership.clear();
    this.tabs.length = 0;
    this.active = '';
    try { this.afterCommit(effects); }
    finally { this.viewStates.clear(); }
  }

  newModel(record) {
    if (record.model) { validateDocumentModel(record, record.model); return record.model; }
    const model = this.modelFactory(record);
    try { validateDocumentModel(record, model); }
    catch (error) { if (!this.ownsModel(model)) model?.dispose?.(); throw error; }
    return model;
  }

  ownsModel(model) { return !!model && this.models.get(model.uri) === model; }

  observeModel(record, model) {
    const uri = record.uri;
    Object.defineProperties(record, {
      text: { enumerable: true, configurable: true, get: () => model.text, set: text => this.update(uri, text) },
      version: { enumerable: true, configurable: true, get: () => model.version },
      model: { enumerable: false, configurable: true, value: model },
      source: { enumerable: false, configurable: true, get: () => model.snapshot() },
      length: { enumerable: false, configurable: true, get: () => model.length }
    });
    const unsubscribe = model.onDidChange(change => this.modelChanged(uri, record, model, change));
    if (typeof unsubscribe !== 'function') throw new TypeError('Document model subscription must return a disposer');
    return unsubscribe;
  }

  finishReplacement({ oldModels, oldSubscriptions, oldUris, preserveEditors, commitMetadata }) {
    const effects = [...(commitMetadata ? [commitMetadata] : []), ...oldSubscriptions];
    if (!preserveEditors) effects.push(() => this.resetEditors());
    else for (const uri of oldUris) if (!this.records.has(uri)) effects.push(() => this.releaseViews(uri));
    for (const [uri, model] of oldModels) if (this.models.get(uri) !== model) effects.push(() => model.dispose?.());
    if (preserveEditors) for (const uri of this.models.keys()) for (const view of this.views.get(uri)?.values() ?? []) {
      effects.push(() => this.setEditorModel(uri, view.editor));
    }
    effects.push(() => this.events.emit({ type: 'reset', files: this.files, tabs: [...this.tabs], active: this.active, revision: this.revision }));
    this.afterCommit(effects);
  }

  afterCommit(effects) {
    const failures = [];
    for (const effect of effects) {
      try { effect(); } catch (error) { failures.push(error); }
    }
    if (failures.length) {
      const error = new AggregateError(failures, 'Documents committed, but a view or cleanup callback failed');
      Object.assign(error, { code: 'DOCUMENT_COMMITTED', committed: true });
      throw error;
    }
  }

  modelChanged(uri, record, model, change) {
    if (this.disposed || this.models.get(uri) !== model || this.records.get(uri) !== record) return;
    if (this.reloadChanges.has(change.bufferEdit)) return;
    const wasDirty = this.dirtyFiles.has(uri);
    const dirty = model.isDirty || this.staleSaves.has(uri) || this.baselines.get(uri) === null;
    record.dirty = dirty;
    if (dirty) this.dirtyFiles.add(uri); else this.dirtyFiles.delete(uri);
    for (const view of this.views.get(uri)?.values() ?? []) {
      if (view.editor.model !== model && !view.editor.setModel) view.editor.setValue?.(change.after.text);
    }
    this.events.emit({
      type: 'changed', uri, record, model, change, changes: change.changes,
      origin: change.options?.origin ?? null, version: change.version, oldVersion: change.oldVersion,
      get previous() { return change.before.text; },
      get text() { return change.after.text; },
      revision: ++this.revision
    });
    if (dirty !== wasDirty) this.events.emit({ type: 'dirty', uri, record, dirty });
  }

  markModelSaved(uri, model, record, options) {
    const saved = savedModelBaseline(model, options);
    if (!saved) return false;
    if (saved.stale) {
      this.baselines.set(uri, saved.baseline);
      this.staleSaves.add(uri);
    } else {
      model.markSaved();
      this.staleSaves.delete(uri);
      this.baselines.set(uri, saved.baseline);
    }
    record.dirty = model.isDirty || this.staleSaves.has(uri);
    if (record.dirty) this.dirtyFiles.add(uri); else this.dirtyFiles.delete(uri);
    this.events.emit({ type: 'saved', uri, record, dirty: record.dirty });
    this.events.emit({ type: 'dirty', uri, record, dirty: record.dirty });
    return !record.dirty;
  }

  setEditorModel(uri, editor) {
    const model = this.models.get(uri);
    if (!model || editor.model === model) return;
    if (editor.setModel) editor.setModel(uri, model);
    else editor.setValue?.(model.text);
  }
}
