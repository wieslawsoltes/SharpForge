import {recordSource} from '@sharpforge/project-system';
import {captureExplorerRecord} from './explorer-records.js';
import {createStudioRecords} from './workbench/workspace-records.js';

function overlayRecord(record, buffer, path) {
  const descriptors = {...Object.getOwnPropertyDescriptors(record ?? {}), ...Object.getOwnPropertyDescriptors(buffer ?? {})};
  descriptors.path = {value: path, enumerable: true, configurable: true};
  if (buffer && !buffer.model && !recordSource(buffer) && typeof Object.getOwnPropertyDescriptor(buffer, 'text')?.value === 'string') {
    delete descriptors.model;
    delete descriptors.source;
    delete descriptors.originalSource;
  }
  if (buffer) descriptors.lazy = {value: false, enumerable: true, configurable: true};
  return captureExplorerRecord(Object.defineProperties({}, descriptors), {models: true, copyBytes: false});
}

/** Capture immutable roots with exact versions; enumerate the directory without materializing source text. */
export function workspaceSourceRecords(state, {nativeBuild, documents} = {}) {
  if (documents) return createStudioRecords({state, documents, nativeBuild})
    .map(record => {
      const captured = captureExplorerRecord(record, {models: true, copyBytes: false});
      if (recordSource(captured)) Object.defineProperty(captured, 'lazy', {value: false, enumerable: true, configurable: true});
      return captured;
    });
  const sources = new Map(state.files.map(file => [file.uri, file]));
  let raw;
  if (state.nativeMode) raw = state.nativeWorkspace?.files ?? [];
  else if (state.projectSystem) raw = [...state.projectSystem.files.values()];
  else {
    const index = new Map((state.extraFiles ?? []).map(record => [record.path, record]));
    for (const file of state.files) index.set(file.uri, state.disk?.record(file.uri) ?? file);
    const ordered = [];
    for (const file of state.disk?.records ?? []) if (index.has(file.path)) {
      ordered.push(index.get(file.path));
      index.delete(file.path);
    }
    raw = [...ordered, ...index.values()];
  }
  return raw.map(record => {
    const path = record.path ?? record.uri;
    const buffer = sources.get(path) ?? (state.nativeMode ? nativeBuild?.buffers.get(path) : null);
    return overlayRecord(record, buffer, path);
  });
}

/** Recovery and history own immutable document state, never the live model or its subscriptions. */
export function workspaceDocumentStates(documents) {
  return documents ? new Map(documents.list().map(record => [record.uri, documents.captureState(record.uri)])) : undefined;
}
