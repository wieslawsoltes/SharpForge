import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { createDocumentEvents } from '../../apps/studio/services/documents.js';
import { createEditorAnnotations } from '../../apps/studio/services/annotations.js';

/** External owner contract over real editor models, without importing unpublished Studio services. */
export function nativeStudioHost({ Model = EditorModel, onChange } = {}) {
  const owner = { files: [], records: new Map(), models: new Map(), editors: new Map(), views: new Map(),
    activeViews: new Map(), baselines: new Map(), dirtyFiles: new Set(), revision: 19, disposed: false };
  const state = { workspaceEpoch: 11, diskRevision: 4, applyingEdits: false, buildDirty: true };
  Object.defineProperties(state, {
    files: { get: () => owner.files }, revision: { get: () => owner.revision }, dirtyFiles: { get: () => owner.dirtyFiles }
  });
  const events = [];
  const nativeEvents = [];
  const effects = [];
  const counters = { recordSetters: 0, resets: 0 };
  const text = () => [...owner.models.values()].map(model => model.text);
  for (const [uri, source] of [['first.cs', 'abcd'], ['second.cs', 'wxyz']]) {
    const model = new Model(source, { uri });
    model.markSaved();
    const record = { uri };
    Object.defineProperties(record, {
      text: { enumerable: true, get: () => model.text, set: value => { counters.recordSetters++; model.setValue(value); } },
      version: { enumerable: true, get: () => model.version }, model: { value: model },
      source: { get: () => model.snapshot() }, length: { get: () => model.length }
    });
    owner.records.set(uri, record);
    owner.models.set(uri, model);
    owner.files.push(record);
    owner.baselines.set(uri, model.snapshot());
    model.onDidChange(change => {
      owner.revision++;
      state.diskRevision++;
      if (model.isDirty) owner.dirtyFiles.add(uri); else owner.dirtyFiles.delete(uri);
      nativeEvents.push({ uri, text: text(), applyingEdits: state.applyingEdits });
      onChange?.(change);
    });
  }
  const documentEvents = createDocumentEvents();
  documentEvents.subscribe(event => events.push({ event, text: text(), revision: owner.revision }));
  const legacyEffect = () => assert.fail('Native edits must not invoke legacy state or editor effects');
  const host = { state, editors: owner.editors, documentEvents, docking: { documents: owner },
    annotations: createEditorAnnotations(), remapSourceBreakpoints: legacyEffect, renderWorkspace: legacyEffect,
    saveLocal: legacyEffect, analyze: legacyEffect, renderTabs: legacyEffect, scheduleAnalysis: legacyEffect,
    designerTools: { sourceSync: { sourceChanged: legacyEffect } } };
  return { host, owner, events, nativeEvents, effects, counters, text };
}
