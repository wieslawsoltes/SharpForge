import {prepareWorkspaceEdit} from '@sharpforge/editor';
import {captureDesignerEditorRollback} from './designer-editor-state.js';

function prepareParticipants(state, editors, edits, remapBreakpoints) {
  const files = new Map(state.files.map(file => [file.uri, file]));
  const workspace = {getDocument: uri => {
    const file = files.get(uri);
    return file && {...file, readOnly: file.readOnly || file.readonly || editors.get(uri)?.readOnly};
  }};
  const versions = new Map(state.files.map(file => [file.uri, file.version]));
  const plan = prepareWorkspaceEdit(workspace, edits, {versions});
  return plan.changes.filter(change => change.before !== change.text).map(change => {
    const file = files.get(change.uri);
    const editor = editors.get(change.uri);
    if (editor && (editor.model.uri !== change.uri || editor.value !== change.before)) {
      throw new Error('Editor source changed before the workspace transaction: ' + change.uri);
    }
    const rollback = captureDesignerEditorRollback(editor);
    const prepared = editor?.model.prepareEdits(change.edits, {
      expectedVersion: editor.model.version, source: 'workspace-edit', command: 'setValue', undoStop: true
    });
    return {
      change, file, editor, rollback, prepared,
      breakpoints: state.breakpoints[change.uri], hasBreakpoints: Object.hasOwn(state.breakpoints, change.uri),
      nextBreakpoints: remapBreakpoints(change.before, change.text, state.breakpoints[change.uri] ?? []),
      dirty: state.dirtyFiles.has(change.uri)
    };
  });
}

function assertCurrent(state, editors, participants, revision) {
  if (state.readOnly || state.revision !== revision) throw new Error('Workspace changed before the source transaction');
  for (const {file, change, editor, rollback} of participants) {
    if (!state.files.includes(file) || file.text !== change.before || file.version !== change.version || file.readOnly || file.readonly ||
        editors.get(change.uri) !== editor || editor &&
        (editor.model !== rollback.model || editor.model.snapshot() !== rollback.source || editor.readOnly)) {
      throw new Error('Source changed before the workspace transaction: ' + change.uri);
    }
  }
}

function rollbackTransaction(state, participants, original, error) {
  state.revision = original.revision;
  state.diskRevision = original.diskRevision;
  state.buildDirty = original.buildDirty;
  for (const participant of participants) {
    const {file, change, breakpoints, hasBreakpoints, dirty} = participant;
    file.text = change.before;
    file.version = change.version;
    if (hasBreakpoints) state.breakpoints[change.uri] = breakpoints;
    else delete state.breakpoints[change.uri];
    if (dirty) state.dirtyFiles.add(change.uri);
    else state.dirtyFiles.delete(change.uri);
  }
  const errors = [error];
  // Restore all source models before rebuilding any view that might inspect a related document.
  for (const {editor, rollback} of participants) {
    if (!editor) continue;
    try {
      rollback.model.restoreCheckpoint(rollback.checkpoint);
    } catch (failure) { errors.push(failure); }
  }
  for (const {editor, rollback} of participants) {
    try { editor?.restoreViewCheckpoint(rollback.view); } catch (failure) { errors.push(failure); }
  }
  if (errors.length > 1) throw new AggregateError(errors, error.message, {cause: error});
  throw error;
}

/** Prepare every file and model before publishing; a rejected application restores exact source/history/view state. */
export function applyDesignerSourceTransaction({state, editors, edits, remapBreakpoints}) {
  if (state.applyingEdits) throw new Error('A source transaction is already being applied');
  if (state.readOnly) throw new Error('Cannot apply source edits while the workspace is read-only');
  const original = {revision: state.revision, diskRevision: state.diskRevision, buildDirty: state.buildDirty};
  const participants = prepareParticipants(state, editors, edits, remapBreakpoints);
  if (!participants.length) return [];
  assertCurrent(state, editors, participants, original.revision);
  state.applyingEdits = true;
  try {
    for (const {editor, prepared} of participants) editor?.model.commitPrepared(prepared, {notify: false});
    for (const {file, change, nextBreakpoints} of participants) {
      file.text = change.text;
      file.version = change.version + 1;
      state.breakpoints[change.uri] = nextBreakpoints;
      state.dirtyFiles.add(change.uri);
    }
    state.revision++;
    state.diskRevision++;
    state.buildDirty = true;
    for (const {editor, prepared} of participants) editor?.model.emitChange(prepared);
  } catch (error) {
    rollbackTransaction(state, participants, original, error);
  } finally {
    state.applyingEdits = false;
  }
  return participants.map(({change}) => change.uri);
}

/** The editor may defer large-file notifications past a host transaction; equal text must not create a second revision. */
export function applyStudioSourceChange({state, uri, text, remapBreakpoints}) {
  if (state.applyingEdits) return false;
  const file = state.files.find(candidate => candidate.uri === uri);
  if (!file || file.text === text) return false;
  const breakpoints = remapBreakpoints(file.text, text, state.breakpoints[uri] ?? []);
  file.text = text;
  file.version++;
  state.breakpoints[uri] = breakpoints;
  state.revision++;
  state.diskRevision++;
  state.buildDirty = true;
  state.dirtyFiles.add(uri);
  return true;
}
