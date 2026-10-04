import { EditorServiceError } from '@sharpforge/editor';
import { validateItemPath } from '@sharpforge/project-system';
import { captureExplorerRecord, explorerSource } from './explorer-records.js';

export function resourceFailure(message, code = 'SFEX_RESOURCE_INVALID') {
  throw new EditorServiceError(code, message);
}

export function resourcePath(value) {
  const path = validateItemPath(value);
  if (path !== value) resourceFailure('Resource paths must use their exact workspace-relative URI');
  return path;
}

function sameSavedState(before, after) {
  return before.version === after.version && before.source === after.source && before.baseline === after.baseline
    && before.dirty === after.dirty && before.staleSave === after.staleSave;
}

/** Capture model and workspace identities before asynchronous source validation; a guard never reads a source text getter. */
export class ExplorerResourceState {
  constructor(documents, explorer, signal) {
    this.documents = documents;
    this.explorer = explorer;
    this.signal = signal;
    const context = explorer.context();
    if (context.native) resourceFailure('Atomic resource rename is unavailable for native disk workspaces', 'SFEX_RESOURCE_UNSUPPORTED');
    if (explorer.editable() !== true || explorer.runningMutation) resourceFailure('Another file operation or read-only workspace blocks rename');
    this.identity = context.identity;
    this.folders = JSON.stringify(context.folders ?? []);
    this.records = new Map();
    this.saved = new Map();
    this.targets = new Map();
    this.ownedModels = new Map(documents.models);
    for (const record of context.records) {
      const captured = captureExplorerRecord(record, { models: true, copyBytes: false });
      this.records.set(record.path, captured);
      if (documents.models.has(record.path)) this.saved.set(record.path, documents.captureState(record.path));
    }
    for (const [uri, model] of this.ownedModels) {
      if (this.records.get(uri)?.model !== model) resourceFailure('Workspace source records are not synchronized: ' + uri);
    }
  }

  cancelled() {
    if (this.signal?.aborted) resourceFailure('Resource rename was cancelled; no files were changed', 'SFEX_RESOURCE_CANCELLED');
  }

  model(uri, version) {
    const record = this.records.get(uri);
    const model = this.documents.models.get(uri);
    if (!record || !model || record.model !== model || model.uri !== uri || model.version !== version || model.readOnly) {
      resourceFailure('Document changed or is read-only: ' + uri, 'SFEX_RESOURCE_CHANGED');
    }
    this.targets.set(uri, { model, source: record.source, version });
    return model;
  }

  validate() {
    this.cancelled();
    const current = this.explorer.context();
    if (current.identity !== this.identity || current.native || current.readOnly
        || current.records.length !== this.records.size || this.documents.models.size !== this.ownedModels.size
        || JSON.stringify(current.folders ?? []) !== this.folders) {
      resourceFailure('Workspace changed before resource rename; no files were changed', 'SFEX_RESOURCE_CHANGED');
    }
    for (const record of current.records) {
      const before = this.records.get(record.path);
      const source = explorerSource(record);
      if (!before || record.model !== before.model || source !== (before.source ?? null)
          || (source?.version ?? record.version) !== before.version || record.encoding !== before.encoding || !!record.bom !== !!before.bom
          || !before.source && (record.text !== before.text || record.bytes !== before.bytes)) {
        resourceFailure('Workspace file changed before resource rename: ' + record.path, 'SFEX_RESOURCE_CHANGED');
      }
      const saved = this.saved.get(record.path);
      if (saved && (!this.documents.models.has(record.path)
          || !sameSavedState(saved, this.documents.captureState(record.path)))) {
        resourceFailure('Document save state changed before resource rename: ' + record.path, 'SFEX_RESOURCE_CHANGED');
      }
    }
    for (const [uri, target] of this.targets) {
      const model = this.documents.models.get(uri);
      if (model !== target.model || model.readOnly || model.version !== target.version || model.snapshot() !== target.source) {
        resourceFailure('Document changed or is read-only: ' + uri, 'SFEX_RESOURCE_CHANGED');
      }
    }
    for (const [uri, model] of this.ownedModels) {
      if (this.documents.models.get(uri) !== model) resourceFailure('Document ownership changed: ' + uri, 'SFEX_RESOURCE_CHANGED');
    }
  }
}

/** Compare in bounded UTF-16 slices and yield for large inputs without materializing the snapshot's complete text. */
export async function matchesResourceSource(source, text, state) {
  if (typeof text !== 'string' || source.length !== text.length) return false;
  for (let offset = 0; offset < source.length; offset += 65_536) {
    state.cancelled();
    const end = Math.min(source.length, offset + 65_536);
    if (source.getText(offset, end) !== text.slice(offset, end)) return false;
    if (end < source.length && end % 1_048_576 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return true;
}
