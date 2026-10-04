import * as Editor from '@sharpforge/editor';

/** Docking exposes the native document owner; the optional documents service is an event channel. */
export function studioDocumentOwner(host) {
  const owner = host.docking?.documents;
  if (owner == null) return null;
  if (owner.disposed || owner.editors !== host.editors || owner.files !== host.state.files ||
      !(owner.editors instanceof Map) || !(owner.records instanceof Map) || !(owner.models instanceof Map)) {
    throw new TypeError('Studio document owner does not match the active workspace');
  }
  return owner;
}

function writableProperty(record, key) {
  for (let current = record; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (!descriptor) continue;
    if ('value' in descriptor) return descriptor.writable && (current === record || Object.isExtensible(record));
    return typeof descriptor.set === 'function';
  }
  return Object.isExtensible(record);
}

/** Reject model-owned records before a legacy text setter can commit only part of an edit. */
export function assertLegacyStudioRecords(files, uris) {
  const targets = new Set(uris);
  for (const file of files) {
    if (!targets.has(file.uri)) continue;
    if (file.model || !writableProperty(file, 'text') || !writableProperty(file, 'version')) {
      throw new TypeError(`An attached native document owner is required to edit ${file.uri}`);
    }
  }
}

function ownedModels(host, owner, uris) {
  if (studioDocumentOwner(host) !== owner) throw new TypeError('Studio document ownership changed');
  const targets = new Map();
  for (const uri of uris) {
    const record = owner.records.get(uri);
    const model = owner.models.get(uri);
    if (!record || record.uri !== uri || !model || model.uri !== uri ||
        record.version !== model.version || record.model && record.model !== model) {
      throw new TypeError(`The native document model is unavailable or has a different owner: ${uri}`);
    }
    for (const method of ['snapshot', 'prepareEdits', 'commitPrepared', 'checkpoint', 'restoreCheckpoint', 'emitChange']) {
      if (typeof model[method] !== 'function') throw new TypeError(`Native model cannot commit atomically: ${uri}`);
    }
    targets.set(uri, { record, model });
  }
  return targets;
}

export function throwStudioFailures(failures, message, { committed = false } = {}) {
  if (committed && failures.length) {
    const error = new AggregateError(failures, message, { cause: failures[0] });
    Object.assign(error, { code: 'DOCUMENT_COMMITTED', committed: true });
    throw error;
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message, { cause: failures[0] });
}

function publishCommittedChanges(host, owner, targets, plan, failures) {
  if (!host.documentEvents) return;
  for (const change of plan.changes) {
    try {
      const target = targets.get(change.uri);
      // A subscriber may have replaced the workspace. Its replacement owns the reset notification.
      if (host.docking.documents !== owner || host.state.files !== owner.files || owner.disposed ||
          owner.records.get(change.uri) !== target.record || owner.models.get(change.uri) !== target.model) continue;
      const text = target.model.text;
      if (text !== change.before) host.documentEvents.publish(change.uri, text);
    } catch (error) { failures.push(error); }
  }
}

/** Native observers own revisions, dirty state and views; an optional A25 bridge runs after the transaction settles. */
export function commitStudioDocumentEdits(host, owner, edits, label) {
  for (const name of ['EditorModelWorkspace', 'prepareWorkspaceEdit', 'commitWorkspaceEdit']) {
    if (typeof Editor[name] !== 'function') throw new TypeError('The editor does not expose native workspace transactions');
  }
  if (host.documentEvents && typeof host.documentEvents.publish !== 'function') {
    throw new TypeError('Invalid Studio document notification channel');
  }
  const targets = ownedModels(host, owner, new Set(edits.map(edit => edit.uri)));
  const versions = new Map([...targets].map(([uri, { model }]) => [uri, model.version]));
  const workspace = new Editor.EditorModelWorkspace(owner.models);
  const plan = Editor.prepareWorkspaceEdit(workspace, edits, { label, versions, maxDocumentLength: 256 * 1024 * 1024 });
  for (const [uri, target] of ownedModels(host, owner, targets.keys())) {
    if (target.record !== targets.get(uri).record || target.model !== targets.get(uri).model) {
      throw new TypeError(`Native document ownership changed while preparing edits: ${uri}`);
    }
  }
  const failures = [];
  let result;
  let committed = false;
  try { result = Editor.commitWorkspaceEdit(workspace, plan); committed = true; }
  catch (error) {
    failures.push(error);
    committed = error?.committed === true;
    // The public atomic adapter restores versions on rollback. Advanced versions identify a committed notification failure.
    for (const change of plan.changes) {
      try { if (targets.get(change.uri).model.version !== change.version) committed = true; }
      catch (failure) { failures.push(failure); }
    }
  }
  // A native subscriber may throw after every model committed; still notify the remaining A25 targets.
  publishCommittedChanges(host, owner, targets, plan, failures);
  throwStudioFailures(failures, 'Studio documents committed, but a notification failed', { committed });
  return result;
}
