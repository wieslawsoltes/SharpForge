import { requireIdentifier, workbenchError, abortError } from './state-events.js';
import { validateDocumentState } from './documents-state.js';

function checkAbort(signal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

/** Validate a prepared model without reading its text or taking ownership. The source must be its current immutable snapshot. */
export function validateDocumentModel(record, model) {
  if (model?.previewActive) throw workbenchError('DOCUMENT_PREVIEW_ACTIVE', 'Finish or cancel the source preview before adopting its model');
  if (!model || !['onDidChange', 'setValue', 'markSaved', 'snapshot'].every(name => typeof model[name] === 'function')) {
    throw new TypeError('Document model factory must return an EditorModel-compatible object');
  }
  if (model.uri !== record.uri || model.version !== record.version) {
    throw new TypeError('Document model URI and version must match its record');
  }
  const snapshot = model.snapshot();
  if (!snapshot || !Object.isFrozen(snapshot) || snapshot.uri !== record.uri || snapshot.version !== record.version) {
    throw new TypeError('Document model must expose a matching immutable source snapshot');
  }
  if (record.source !== undefined && record.source !== snapshot) {
    throw workbenchError('DOCUMENT_SOURCE_STALE', 'Prepared source no longer matches its model');
  }
  if (record.length !== undefined && record.length !== snapshot.length) {
    throw new TypeError('Prepared document length does not match its model');
  }
  try { model.prepareEdits?.([], { expectedVersion: record.version }); }
  catch (error) {
    // A live project-locked model may be retained without making it writable. Disposed models still reject.
    if (!model.readOnly || error.code !== 'SFEDITOR_READ_ONLY') throw error;
  }
  return snapshot;
}

/** Descriptor-preserving ingress normalizes path to URI. Prepared models and source roots never enter JSON or object-spread exports. */
export function documentRecord(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Document record must be an object');
  const uri = requireIdentifier(input.uri ?? input.path, 'Document URI');
  const version = input.version ?? input.model?.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('Invalid document version');
  if (input.byteLength !== undefined && (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0)) {
    throw new RangeError('Invalid document byte length');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of ['text', 'version', 'uri', 'dirty', 'model', 'source', 'originalSource', 'length']) {
    if (descriptors[key]) descriptors[key] = { ...descriptors[key], configurable: true };
  }
  descriptors.uri = { value: uri, enumerable: true, configurable: true, writable: true };
  descriptors.version = { value: version, enumerable: true, configurable: true, writable: true };
  descriptors.dirty = { value: false, enumerable: true, configurable: true, writable: true };
  for (const key of ['model', 'source', 'originalSource']) if (descriptors[key]) descriptors[key].enumerable = false;
  const record = Object.defineProperties({}, descriptors);
  if (record.model) validateDocumentModel(record, record.model);
  else {
    const text = input.text;
    if (typeof text !== 'string') throw new TypeError('Document text must be a string');
    Object.defineProperty(record, 'text', { value: text, enumerable: true, configurable: true, writable: true });
  }
  return record;
}

/** Preflight record/model/subscription ownership before any existing document or view is changed. */
export class DocumentIngress {
  constructor(owner, { signal, preserveEditors = false, preserveDirty = false, documentStates = null } = {}) {
    if (documentStates !== null && !(documentStates instanceof Map)) throw new TypeError('Restored document states must be a Map');
    Object.assign(this, { owner, signal, preserveEditors, preserveDirty, documentStates });
    this.revision = owner.revision;
    this.records = new Map();
    this.models = new Map();
    this.baselines = new Map();
    this.sources = new Map();
    this.preserved = new Set();
    this.staleSaves = new Set();
    this.restoredDirty = new Set();
    this.subscriptions = new Map();
    this.created = new Set();
    this.savedCheckpoints = new Map();
    this.committed = false;
  }

  prepare(values, { dirty = false } = {}) {
    try {
      checkAbort(this.signal);
      for (const value of values) {
        const record = documentRecord(value);
        if (this.records.has(record.uri)) throw new TypeError(`Duplicate document '${record.uri}'`);
        this.records.set(record.uri, record);
      }
      for (const uri of this.documentStates?.keys() ?? []) {
        if (!this.records.has(uri)) throw new TypeError('Restored state refers to a missing document');
      }
      for (const record of this.records.values()) {
        checkAbort(this.signal);
        let model = record.model;
        const previous = this.preserveEditors ? this.owner.models.get(record.uri) : null;
        if (!model && previous?.version === record.version && previous.text === record.text) model = previous;
        if (!model && this.owner.modelFactory) {
          model = this.owner.newModel(record);
          if (!this.owner.ownsModel(model)) this.created.add(model);
        }
        const source = model ? validateDocumentModel(record, model) : record.text;
        const preserve = this.preserveDirty && model && this.owner.ownsModel(model);
        this.baselines.set(record.uri, preserve ? this.owner.baselines.get(record.uri) : dirty ? null : source);
        record.dirty = preserve ? this.owner.dirtyFiles.has(record.uri) : dirty;
        if (preserve) {
          this.preserved.add(record.uri);
          if (this.owner.staleSaves.has(record.uri)) this.staleSaves.add(record.uri);
        }
        const restored = this.documentStates?.get(record.uri);
        if (this.documentStates?.has(record.uri)) {
          validateDocumentState(restored, record, source);
          this.baselines.set(record.uri, restored.dirty ? restored.baseline : source);
          record.dirty = restored.dirty;
          this.staleSaves.delete(record.uri);
          if (restored.dirty) {
            this.restoredDirty.add(record.uri);
            if (restored.staleSave || restored.baseline !== null && !model?.isDirty) this.staleSaves.add(record.uri);
          }
        }
        if (model) {
          this.sources.set(record.uri, source);
          this.models.set(record.uri, model);
          this.subscriptions.set(record.uri, this.owner.observeModel(record, model));
        }
      }
      this.checkCurrent();
      return this;
    } catch (error) { this.reject(error); }
  }

  checkCurrent() {
    checkAbort(this.signal);
    if (this.owner.disposed || this.owner.revision !== this.revision) {
      throw workbenchError('DOCUMENT_INGRESS_STALE', 'The workspace changed during document preparation');
    }
    for (const [uri, model] of this.models) {
      if (model.snapshot() !== this.sources.get(uri)) {
        throw workbenchError('DOCUMENT_SOURCE_STALE', 'A prepared model changed during document preparation');
      }
    }
  }

  /** Saved-state changes are reversible until ownership commits, including a failed later model in the same batch. */
  prepareSavedState() {
    try {
      this.checkCurrent();
      for (const [uri, model] of this.models) if ((!this.preserved.has(uri) || this.documentStates?.has(uri)) && !this.restoredDirty.has(uri)
          && this.baselines.get(uri) !== null && model.isDirty) {
        if (typeof model.checkpoint !== 'function' || typeof model.restoreCheckpoint !== 'function') {
          throw new TypeError('Dirty document models must support checkpoint restoration');
        }
        this.savedCheckpoints.set(model, model.checkpoint());
      }
      for (const model of this.savedCheckpoints.keys()) model.markSaved();
      this.checkCurrent();
    } catch (error) { this.reject(error); }
  }

  commit() {
    this.committed = true;
    this.savedCheckpoints.clear();
    this.created.clear();
  }

  cancel() {
    if (this.committed) return [];
    const failures = [];
    const attempt = action => {
      try { action(); } catch (error) { failures.push(error); }
    };
    for (const dispose of this.subscriptions.values()) attempt(dispose);
    this.subscriptions.clear();
    for (const [model, checkpoint] of this.savedCheckpoints) attempt(() => model.restoreCheckpoint(checkpoint, { notify: false }));
    this.savedCheckpoints.clear();
    for (const model of this.created) attempt(() => model.dispose?.());
    this.created.clear();
    return failures;
  }

  reject(cause) {
    const failures = this.cancel();
    if (failures.length) throw new AggregateError([cause, ...failures], 'Document preparation failed and cleanup reported errors');
    throw cause;
  }
}
