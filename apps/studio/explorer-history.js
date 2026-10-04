import { isSourceSnapshot } from '@sharpforge/project-system';
import { captureExplorerRecord, explorerSource, explorerRecordSize, sameExplorerRecord, prepareExplorerRecord } from './explorer-records.js';

export function documentStateFor(record, previous = null, { created = false, changed = false } = {}) {
  const uri = record.path;
  const source = explorerSource(record) ?? record.text;
  if (!/\.cs$/i.test(uri) || source === undefined) return null;
  let baseline = created ? null : previous ? previous.baseline : source;
  const dirty = created || changed || !!previous?.dirty;
  if (!dirty) baseline = source;
  else if (isSourceSnapshot(baseline) && baseline.uri !== uri) baseline = baseline.withMetadata({ uri });
  return Object.freeze({ uri, version: record.version ?? 1, source, baseline, dirty, staleSave: !created && !!previous?.staleSave });
}

/** File-operation history owns immutable roots only; a deleted document's disposed model is never revived. */
export function captureExplorerWorkspace(owner, context) {
  const documentStates = new Map();
  for (const record of context.records) {
    const state = owner.host.captureDocumentState?.(record.path);
    if (state) documentStates.set(record.path, state);
  }
  return {
    records: context.records.map(record => captureExplorerRecord(record)), documentStates,
    folders: [...context.folders ?? []], active: context.active, tabs: [...context.tabs ?? []],
    breakpoints: structuredClone(context.breakpoints ?? {}), startup: context.startup,
    entry: context.solutionPath ?? context.entry
  };
}

export function pushExplorerHistory(owner, entry) {
  owner.history.push(entry);
  let size = owner.history.reduce((total, item) => total + (item.size ?? 0), 0);
  while (owner.history.length > 1 && (owner.history.length > 32 || size > 32 * 1024 * 1024)) {
    size -= owner.history.shift().size ?? 0;
  }
}

export function previewHistory(owner, before, folders) {
  const after = owner.context().records.map(record => captureExplorerRecord(record));
  return { native: false, before, after, afterFolders: [...folders],
    size: [...before.records, ...after].reduce((total, record) => total + explorerRecordSize(record), 0) };
}

export function validateExplorerUndo(entry, context) {
  const expected = new Map(entry.after.map(record => [record.path, record]));
  if (context.records.length !== expected.size || context.records.some(record => !sameExplorerRecord(expected.get(record.path), record))
      || JSON.stringify(context.folders ?? []) !== JSON.stringify(entry.afterFolders)) {
    throw new Error('Workspace files changed after that operation. Undo would overwrite newer edits; no files were changed.');
  }
}

export function prepareExplorerUndo(entry, context, created) {
  const current = new Map(context.records.map(record => [record.path, record]));
  const records = entry.before.records.map(record => {
    const existing = current.get(record.path);
    if (sameExplorerRecord(record, existing)) return prepareExplorerRecord(existing);
    const restored = prepareExplorerRecord(record);
    if (restored.model) created.add(restored.model);
    return restored;
  });
  return { ...entry.before, records, mappings: [], restore: entry.before };
}

/** Dispose transaction-created models that the committed host did not adopt, including unused intermediate replacements. */
export function releaseExplorerModels(owner, models, { committed = false, records = [] } = {}) {
  const retained = new Set(committed ? records.map(record => record.model).filter(Boolean) : []);
  for (const model of models) {
    const owned = owner.host.ownsModel ? owner.host.ownsModel(model) : retained.has(model);
    if (!owned) model.dispose();
  }
}
