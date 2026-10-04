import { encodeWorkspaceFile } from '@sharpforge/project-system';
import { workbenchError } from './state-events.js';
import { AUTOMATIC_DOCUMENT_CHARACTERS } from './document-size.js';

const COMPARE_CHUNK = 64 * 1024;

function checkOwner(owner, uri, record, model, options) {
  if (owner.require(uri) !== record || options.expectedRecord !== record || owner.models.get(uri) !== model
      || !Number.isSafeInteger(options.expectedVersion) || options.expectedVersion !== record.version) {
    throw workbenchError('DOCUMENT_STALE', 'The document changed while its external source was being read');
  }
  if (record.readOnly || model?.readOnly || [...owner.views.get(uri)?.values() ?? []].some(view => view.editor.readOnly)) {
    throw workbenchError('DOCUMENT_READ_ONLY', 'The document is read-only and cannot accept an external reload');
  }
}

/** Compare bounded ranges instead of materializing the previous buffer; unchanged prefixes/suffixes retain view positions. */
function replacementEdits(before, text) {
  let start = 0;
  const maximum = Math.min(before.length, text.length);
  while (start < maximum) {
    const size = Math.min(COMPARE_CHUNK, maximum - start);
    const previous = before.getText(start, start + size);
    let equal = 0;
    while (equal < size && previous.charCodeAt(equal) === text.charCodeAt(start + equal)) equal++;
    start += equal;
    if (equal !== size) break;
  }
  let oldEnd = before.length;
  let newEnd = text.length;
  while (oldEnd > start && newEnd > start) {
    const size = Math.min(COMPARE_CHUNK, oldEnd - start, newEnd - start);
    const previous = before.getText(oldEnd - size, oldEnd);
    let equal = 0;
    while (equal < size && previous.charCodeAt(size - equal - 1) === text.charCodeAt(newEnd - equal - 1)) equal++;
    oldEnd -= equal;
    newEnd -= equal;
    if (equal !== size) break;
  }
  return start === oldEnd && start === newEnd ? [] : [{ start, end: oldEnd, text: text.slice(start, newEnd) }];
}

function metadata(record, model, text, options) {
  const encoding = options.encoding ?? record.encoding ?? model?.buffer?.encoding ?? 'utf-8';
  const bom = options.bom ?? record.bom ?? model?.buffer?.bom ?? false;
  if (typeof encoding !== 'string' || typeof bom !== 'boolean') throw new TypeError('Invalid external source encoding or BOM');
  const byteLength = encodeWorkspaceFile({ path: record.uri, text, encoding, bom }).byteLength;
  if (options.byteLength !== undefined && options.byteLength !== byteLength) {
    throw new TypeError('External source byte length does not match its text and encoding');
  }
  return { encoding, bom, byteLength };
}

function recordChanges(record, values) {
  const previous = new Map();
  const next = {};
  for (const [key, value] of Object.entries(values)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor && !descriptor.configurable) {
      if ('value' in descriptor && descriptor.value === value) continue;
      throw new TypeError('External reload metadata is immutable: ' + key);
    }
    previous.set(key, descriptor);
    next[key] = { value, configurable: true, writable: true, enumerable: key !== 'originalSource' };
  }
  return {
    apply() { Object.defineProperties(record, next); },
    restore() {
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(record, key, descriptor);
        else delete record[key];
      }
    }
  };
}

function prepareModel(model, text, version) {
  const methods = ['prepareEdits', 'commitPrepared', 'checkpoint', 'restoreCheckpoint', 'markSaved', 'emitChange'];
  if (!methods.every(name => typeof model[name] === 'function') || !model.buffer) {
    throw new TypeError('External reload requires a transactional editor model');
  }
  const before = model.snapshot();
  const edits = replacementEdits(before, text);
  if (edits.length && version === Number.MAX_SAFE_INTEGER) throw new RangeError('Document version cannot advance');
  const prepared = model.prepareEdits(edits, { source: 'document-reload', command: 'reload', expectedVersion: version, undoStop: true });
  if (!prepared?.bufferEdit || typeof prepared.bufferEdit !== 'object') {
    throw new TypeError('External reload requires a prepared buffer transaction');
  }
  return prepared;
}

function publish(owner, uri, record, model, prepared, previous, result, failure) {
  const legacyText = model ? null : record.text;
  const current = () => !owner.disposed && owner.records.get(uri) === record && owner.models.get(uri) === model
    && record.version === result.version && (model ? model.snapshot() === result.source : record.text === legacyText);
  const effects = failure ? [() => { throw failure; }] : [];
  if (model) owner.reloadChanges.add(prepared.bufferEdit);
  if (prepared?.changes.length || !model && previous !== record.text) {
    effects.push(() => {
      if (!current()) return;
      owner.events.emit(model ? {
        type: 'changed', uri, record, model, change: prepared, changes: prepared.changes,
        origin: null, version: result.version, oldVersion: prepared.oldVersion, revision: owner.revision,
        get previous() { return prepared.before.text; }, get text() { return prepared.after.text; }
      } : { type: 'changed', uri, record, previous, origin: null, revision: owner.revision });
    });
  }
  if (model) effects.push(() => { if (current()) model.emitChange(prepared); });
  for (const view of owner.views.get(uri)?.values() ?? []) {
    if (!model || view.editor.model !== model && !view.editor.setModel) {
      effects.push(() => { if (current()) view.editor.setValue?.(record.text); });
    }
  }
  effects.push(() => { if (current()) owner.events.emit({ type: 'saved', uri, record, dirty: record.dirty, source: result.source }); });
  effects.push(() => { if (current()) owner.events.emit({ type: 'dirty', uri, record, dirty: record.dirty }); });
  try { owner.afterCommit(effects); }
  finally { if (model) owner.reloadChanges.delete(prepared.bufferEdit); }
}

/**
 * Commit a watcher-approved source synchronously. Acceptance may roll back before metadata publication;
 * committed metadata errors and notification failures preserve both sides and report DOCUMENT_COMMITTED.
 */
export function reloadDocument(owner, uri, text, options = {}) {
  const record = owner.require(uri);
  const model = owner.models.get(uri);
  checkOwner(owner, uri, record, model, options);
  if (typeof text !== 'string') throw new TypeError('External reload requires bounded source text');
  if (text.length > AUTOMATIC_DOCUMENT_CHARACTERS || (model?.length ?? record.text.length) > AUTOMATIC_DOCUMENT_CHARACTERS) {
    throw workbenchError('DOCUMENT_RELOAD_LIMIT', `External reload is limited to ${AUTOMATIC_DOCUMENT_CHARACTERS} UTF-16 code units`);
  }
  if (options.commitMetadata !== undefined && typeof options.commitMetadata !== 'function') {
    throw new TypeError('Invalid external source metadata contribution');
  }
  const format = metadata(record, model, text, options);
  const previous = model ? null : record.text;
  const prepared = model ? prepareModel(model, text, record.version) : null;
  const changed = model ? prepared.changes.length > 0 : previous !== text;
  if (changed && record.version === Number.MAX_SAFE_INTEGER) throw new RangeError('Document version cannot advance');
  const source = prepared?.after;
  const version = prepared?.version ?? record.version + (changed ? 1 : 0);
  const fields = recordChanges(record, { ...format, dirty: false,
    ...(model ? { originalSource: source } : { text, version }) });
  const checkpoint = model?.checkpoint();
  const bufferFormat = model ? { encoding: model.buffer.encoding, bom: model.buffer.bom } : null;
  const baseline = owner.baselines.get(uri);
  const dirty = owner.dirtyFiles.has(uri);
  const stale = owner.staleSaves.has(uri);
  const revision = owner.revision;
  checkOwner(owner, uri, record, model, options);
  const result = Object.freeze({ committed: true, record, source, version, ...format });
  let committedFailure;
  try {
    if (model) {
      model.commitPrepared(prepared, { notify: false });
      model.markSaved();
      model.buffer.encoding = format.encoding;
      model.buffer.bom = format.bom;
      model.buffer.preferredEol = model.metadata.dominantEol;
    }
    fields.apply();
    owner.baselines.set(uri, source ?? text);
    owner.dirtyFiles.delete(uri);
    owner.staleSaves.delete(uri);
    owner.revision++;
    const accepted = options.commitMetadata?.(result);
    if (accepted && typeof accepted.then === 'function') throw new TypeError('External source metadata acceptance must be synchronous');
  } catch (error) {
    if (error?.committed === true) committedFailure = error;
    else {
      if (model) {
        model.restoreCheckpoint(checkpoint, { notify: false });
        Object.assign(model.buffer, bufferFormat);
      }
      fields.restore();
      owner.baselines.set(uri, baseline);
      if (dirty) owner.dirtyFiles.add(uri); else owner.dirtyFiles.delete(uri);
      if (stale) owner.staleSaves.add(uri); else owner.staleSaves.delete(uri);
      owner.revision = revision;
      throw error;
    }
  }
  publish(owner, uri, record, model, prepared, previous, result, committedFailure);
  return result;
}
