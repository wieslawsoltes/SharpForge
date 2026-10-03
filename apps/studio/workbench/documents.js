import { WorkbenchEvents, requireIdentifier, workbenchError } from './state-events.js';

function documentRecord(record) {
  requireIdentifier(record?.uri, 'Document URI');
  if (typeof record.text !== 'string') throw new TypeError('Document text must be a string');
  const version = record.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('Invalid document version');
  return { ...record, version };
}

/** Workspace documents own text and editors; prompt/tab placement policies belong to the host. */
export class DocumentService {
  constructor({ records = [], createEditor, createModel, modelFactory, saveDocument, maxDocuments = 20_000 } = {}) {
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
    this.events = new WorkbenchEvents();
    this.revision = 0;
    this.disposed = false;
    this.createEditor = createEditor;
    this.modelFactory = createModel ?? modelFactory;
    this.saveDocument = saveDocument;
    this.maxDocuments = maxDocuments;
    this.replace(records, { discard: true });
  }

  subscribe(listener, options) { return this.events.subscribe(listener, options); }
  get files() { return this.recordList; }
  get(uri) {
    const found = this.records.get(uri);
    if (found) return found;
    const appended = this.recordList.find(record => record.uri === uri);
    if (appended) {
      this.records.set(uri, appended);
      if (!this.baselines.has(uri)) this.baselines.set(uri, appended.text);
      if (this.modelFactory) this.bindModel(appended, this.newModel(documentRecord(appended)));
    }
    return appended ?? null;
  }
  list() { return this.files; }

  require(uri) {
    if (this.disposed) throw workbenchError('DOCUMENTS_DISPOSED', 'Document service is disposed');
    const record = this.get(uri);
    if (!record) throw workbenchError('DOCUMENT_MISSING', `Document '${uri}' is not open in this workspace`);
    return record;
  }

  replace(records, { tabs = [], active = '', discard = false, preserveEditors = false } = {}) {
    if (!Array.isArray(records) || records.length > this.maxDocuments) throw new RangeError('Document limit exceeded');
    if (this.dirtyFiles.size && !discard) throw workbenchError('DOCUMENT_DIRTY', 'Save or discard changed documents before replacing the workspace');
    const next = new Map();
    for (const value of records) {
      const record = documentRecord(value);
      if (next.has(record.uri)) throw new TypeError(`Duplicate document '${record.uri}'`);
      next.set(record.uri, record);
    }
    if (tabs.some(uri => !next.has(uri)) || active && !next.has(active)) throw new TypeError('Invalid restored document tabs');
    const models = new Map();
    try {
      if (this.modelFactory) for (const [uri, record] of next) {
        const previous = preserveEditors ? this.models.get(uri) : null;
        models.set(uri, previous && previous.version === record.version && previous.text === record.text ? previous : this.newModel(record));
      }
    } catch (error) {
      for (const [uri, model] of models) if (this.models.get(uri) !== model) model.dispose?.();
      throw error;
    }
    if (!preserveEditors) this.resetEditors();
    else for (const uri of this.records.keys()) if (!next.has(uri)) this.releaseViews(uri);
    for (const dispose of this.modelSubscriptions.values()) dispose();
    this.modelSubscriptions.clear();
    for (const [uri, model] of this.models) if (models.get(uri) !== model) model.dispose?.();
    this.models.clear();
    this.records = next;
    this.recordList = [...next.values()];
    for (const record of this.recordList) record.dirty = false;
    this.baselines = new Map([...next].map(([uri, record]) => [uri, record.text]));
    this.dirtyFiles.clear();
    this.staleSaves.clear();
    for (const [uri, model] of models) {
      model.markSaved();
      this.bindModel(next.get(uri), model);
      for (const view of this.views.get(uri)?.values() ?? []) this.setEditorModel(uri, view.editor);
    }
    this.tabs = [...new Set(tabs)];
    this.active = active || this.tabs[0] || '';
    if (this.active && !this.tabs.includes(this.active)) this.tabs.push(this.active);
    this.revision++;
    this.events.emit({ type: 'reset', files: this.files, tabs: [...this.tabs], active: this.active, revision: this.revision });
  }

  add(value, { dirty = false } = {}) {
    const record = documentRecord(value);
    if (this.records.has(record.uri)) throw new TypeError(`Duplicate document '${record.uri}'`);
    if (this.records.size >= this.maxDocuments) throw new RangeError('Document limit exceeded');
    const model = this.modelFactory ? this.newModel(record) : null;
    this.records.set(record.uri, record);
    this.recordList.push(record);
    this.baselines.set(record.uri, dirty ? null : record.text);
    if (dirty) this.dirtyFiles.add(record.uri);
    record.dirty = dirty;
    if (model) this.bindModel(record, model);
    this.events.emit({ type: 'added', uri: record.uri, record, revision: ++this.revision });
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

  markSaved(uri, { version, text } = {}) {
    const record = this.require(uri);
    const model = this.models.get(uri);
    if (model) return this.markModelSaved(uri, model, record, { version, text });
    const baseline = text ?? record.text;
    if (version !== undefined && version !== record.version && text === undefined) return false;
    this.baselines.set(uri, baseline);
    record.dirty = record.text !== baseline;
    if (record.dirty) this.dirtyFiles.add(uri); else this.dirtyFiles.delete(uri);
    this.events.emit({ type: 'saved', uri, record, dirty: record.dirty });
    this.events.emit({ type: 'dirty', uri, record, dirty: record.dirty });
    return !record.dirty;
  }

  async save(uri) {
    const record = this.require(uri);
    if (!this.saveDocument) throw workbenchError('DOCUMENT_SAVE_UNAVAILABLE', 'No document save provider is registered');
    const editor = this.views.get(uri)?.get(this.activeViews.get(uri))?.editor ?? this.editors.get(uri);
    const prepared = editor?.prepareSave?.();
    if (prepared && typeof prepared.then === 'function') await prepared;
    if (this.records.get(uri) !== record) return false;
    const snapshot = { ...record };
    const result = await this.saveDocument(snapshot);
    if (result === false || result?.ok === false) return false;
    if (this.records.get(uri) !== record) return false;
    return this.markSaved(uri, { version: snapshot.version, text: snapshot.text });
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
    for (const [viewId, view] of this.views.get(uri) ?? []) {
      const saved = this.viewStates.get(uri) ?? new Map();
      saved.set(viewId, this.getViewState(uri, viewId));
      this.viewStates.set(uri, saved);
      view.editor.dispose?.();
    }
    this.views.delete(uri);
    this.editors.delete(uri);
    this.activeViews.delete(uri);
  }

  resetEditors() { for (const uri of [...this.views.keys()]) this.releaseViews(uri); }

  snapshot() {
    return { files: this.files.map(record => ({ ...record })), tabs: [...this.tabs], active: this.active, dirtyFiles: [...this.dirtyFiles] };
  }

  dispose() {
    if (this.disposed) return;
    this.resetEditors();
    for (const dispose of this.modelSubscriptions.values()) dispose();
    this.modelSubscriptions.clear();
    for (const model of this.models.values()) model.dispose?.();
    this.models.clear();
    this.disposed = true;
    this.events.dispose();
  }

  newModel(record) {
    const model = this.modelFactory(record);
    if (!model || !['onDidChange', 'setValue', 'markSaved', 'snapshot'].every(name => typeof model[name] === 'function')) {
      model?.dispose?.();
      throw new TypeError('Document model factory must return an EditorModel-compatible object');
    }
    if (model.uri !== record.uri || model.version !== record.version) {
      model.dispose?.();
      throw new TypeError('Document model URI and version must match its record');
    }
    return model;
  }

  bindModel(record, model) {
    const uri = record.uri;
    this.models.set(uri, model);
    if (this.baselines.get(uri) !== null) this.baselines.set(uri, model.snapshot());
    record.dirty = model.isDirty || this.baselines.get(uri) === null;
    Object.defineProperties(record, {
      text: { enumerable: true, configurable: true, get: () => model.text, set: text => this.update(uri, text) },
      version: { enumerable: true, configurable: true, get: () => model.version }
    });
    this.modelSubscriptions.set(uri, model.onDidChange(change => this.modelChanged(uri, record, model, change)));
  }

  modelChanged(uri, record, model, change) {
    if (this.disposed || this.models.get(uri) !== model || this.records.get(uri) !== record) return;
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

  markModelSaved(uri, model, record, { version, text }) {
    if (version !== undefined && version !== model.version || text !== undefined && text !== model.text) {
      if (text === undefined) return false;
      this.baselines.set(uri, text);
      this.staleSaves.add(uri);
    } else {
      model.markSaved();
      this.staleSaves.delete(uri);
      this.baselines.set(uri, model.snapshot());
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
