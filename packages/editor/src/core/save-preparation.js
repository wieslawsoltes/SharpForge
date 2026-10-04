import {hasSaveNormalization, saveTextEditsAsync} from '../save-normalization.js';

function staleSave(message) {
  const error = new Error(message);
  error.code = 'SFEDITOR_SAVE_STALE';
  return error;
}

/** No enabled normalization returns the existing snapshot synchronously; enabled work is private, cooperative and atomic. */
export function prepareEditorSave(editor, controls = {}) {
  const model = editor.model;
  const before = model.publishedSnapshot?.() ?? model.snapshot();
  const ownershipEpoch = model.editOwnershipEpoch;
  const optionsRevision = editor.optionsRevision;
  const check = () => {
    if (controls.signal?.aborted) throw new DOMException('Save preparation cancelled', 'AbortError');
    if (editor.disposed || editor.model !== model || (model.publishedSnapshot?.() ?? model.snapshot()) !== before
        || model.editOwnershipEpoch !== ownershipEpoch || editor.optionsRevision !== optionsRevision) {
      throw staleSave('The document or its text options changed while preparing to save; no normalization was applied.');
    }
  };
  check();
  const options = {...editor.options, normalizeLineEndings: editor.endOfLineExplicit};
  if (!hasSaveNormalization(options)) return before;
  if (model.previewActive) throw staleSave('Finish or cancel the source preview before normalizing the saved document.');
  return normalizeEditorSave(editor, {model, before, options}, {...controls, check, maxEdits: model.buffer.maxEdits});
}

async function normalizeEditorSave(editor, captured, controls) {
  const {model, before, options} = captured;
  const edits = await saveTextEditsAsync(before, options, controls);
  controls.check();
  if (!edits.length) return before;
  const prepared = await model.prepareEditsAsync(edits, {
    ...controls, expectedVersion: before.version, source: 'save-normalize', command: 'save-normalize', undoStop: true
  });
  controls.check();
  if (!editor.commitPrepared(prepared)) throw staleSave('The document became unavailable before save normalization could commit.');
  return model.snapshot();
}
