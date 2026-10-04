import {readWorkspaceDocument} from './workspace-edit.js';
import {EditorServiceError} from './providers.js';

/** Atomic workspace adapter for EditorModel instances: root swaps precede every change notification. */
export class EditorModelWorkspace {
  constructor(models = new Map()) {
    this.models = models;
  }

  getDocument(uri) {
    const model = this.models.get(uri);
    if (!model) return undefined;
    const source = model.snapshot();
    return {uri, get text() { return source.text; }, length: source.length, source,
      version: model.version, readOnly: model.readOnly, model};
  }

  listDocuments() { return [...this.models.keys()].map(uri => this.getDocument(uri)); }

  applyTransaction(plan) {
    const staged = plan.changes.map(change => {
      const current = readWorkspaceDocument(this, change.uri);
      if (current.version !== change.version || current.text !== change.before || current.readOnly) {
        throw new EditorServiceError('SFED1113', `Workspace changed before commit: ${change.uri}`);
      }
      const model = this.models.get(change.uri);
      if (!model.prepareEdits || !model.commitPrepared || !model.checkpoint || !model.restoreCheckpoint || !model.emitChange) {
        throw new EditorServiceError('SFED1116', `Model cannot participate in an atomic transaction: ${change.uri}`);
      }
      return {model, checkpoint: model.checkpoint(), prepared: model.prepareEdits(change.edits, {source: plan.label, undoStop: true})};
    });
    for (let index = 0; index < staged.length; index++) {
      if (staged[index].model.version !== plan.changes[index].version) {
        throw new EditorServiceError('SFED1113', 'Workspace changed while preparing the transaction');
      }
    }
    try {
      for (const item of staged) item.event = item.model.commitPrepared(item.prepared, {notify: false});
    } catch (error) {
      for (const item of staged) item.model.restoreCheckpoint(item.checkpoint, {notify: false});
      throw error;
    }
    const errors = [];
    for (const item of staged) {
      try { item.model.emitChange(item.event ?? item.prepared); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Workspace committed, but a change subscriber failed');
    return {changes: plan.changes};
  }
}
