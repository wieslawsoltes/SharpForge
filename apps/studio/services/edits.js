import { captureStudioDocuments, publishStudioDocumentChanges } from './documents.js';
import { assertLegacyStudioRecords, commitStudioDocumentEdits, studioDocumentOwner } from './document-owner.js';

/** Apply the same source edit transaction for refactorings and optional editor integrations. */
export function applyStudioTextEdits(host, edits) {
  const owner = studioDocumentOwner(host);
  if (owner) return commitStudioDocumentEdits(host, owner, edits, 'Workspace edit');
  assertLegacyStudioRecords(host.state.files, edits.map(edit => edit.uri));
  const { state, editors } = host;
  state.applyingEdits = true;
  try {
    for (const file of state.files) {
      const fileEdits = edits.filter(edit => edit.uri === file.uri).sort((left, right) => right.start - left.start);
      if (!fileEdits.length) continue;
      const before = file.text;
      for (const edit of fileEdits) file.text = file.text.slice(0, edit.start) + edit.newText + file.text.slice(edit.end);
      state.breakpoints[file.uri] = host.remapSourceBreakpoints(before, file.text, state.breakpoints[file.uri] ?? []);
      file.version++;
      state.dirtyFiles.add(file.uri);
      const instance = editors.get(file.uri);
      if (instance && instance.value !== file.text) instance.setValue(file.text);
    }
  } finally { state.applyingEdits = false; }
  state.revision++;
  state.diskRevision++;
  state.buildDirty = true;
  host.renderWorkspace();
  host.saveLocal();
  host.analyze();
  for (const uri of new Set(edits.map(edit => edit.uri))) {
    host.designerTools?.sourceSync.sourceChanged(uri);
    const file = state.files.find(item => item.uri === uri);
    if (file) host.documentEvents.publish(uri, file.text);
  }
}

/** Debugger source restoration completes its model transaction before publishing replacement notifications. */
export function restoreStudioDebugSources(host, originals) {
  const owner = studioDocumentOwner(host);
  if (owner) {
    const edits = originals.filter(original => owner.records.has(original.uri)).map(original => {
      const model = owner.models.get(original.uri);
      return { uri: original.uri, start: 0, end: model?.length, newText: original.text, version: model?.version };
    });
    return commitStudioDocumentEdits(host, owner, edits, 'Restore debugger sources');
  }
  assertLegacyStudioRecords(host.state.files, originals.map(original => original.uri));
  const { state, editors } = host;
  const previous = captureStudioDocuments(state.files);
  state.applyingEdits = true;
  try {
    for (const original of originals) {
      const file = state.files.find(item => item.uri === original.uri);
      if (!file) continue;
      file.text = original.text;
      file.version++;
      editors.get(file.uri)?.setModel(file.uri, file.text);
    }
  } finally { state.applyingEdits = false; }
  state.revision++;
  state.buildDirty = false;
  host.renderTabs();
  host.scheduleAnalysis();
  publishStudioDocumentChanges(host.documentEvents, previous, state.files);
}
