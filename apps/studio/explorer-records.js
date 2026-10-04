import { EditorModel, rebaseEditorSource } from '@sharpforge/editor';
import { cloneWorkspaceRecord, recordSource, isSourceSnapshot } from '@sharpforge/project-system';
import { studioDiskLimits } from './workbench/workspace-limits.js';

export const withinExplorerPath = (path, root) => path === root || path.startsWith(root + '/');

export function explorerSource(record) { return record?.model?.snapshot() ?? recordSource(record); }

/** Snapshots capture current model state. History deliberately omits mutable models and retains only immutable source roots. */
export function captureExplorerRecord(record, { models = false, copyBytes = true } = {}) {
  const path = record.path ?? record.uri;
  const descriptors = Object.getOwnPropertyDescriptors(cloneWorkspaceRecord(record, path));
  const source = explorerSource(record);
  if (source) {
    if (!isSourceSnapshot(source) || source.uri !== path) throw new TypeError('Explorer source URI does not match its record');
    descriptors.source = { value: source, configurable: true };
    descriptors.length = { value: source.length, configurable: true };
    descriptors.version = { value: source.version, configurable: true, enumerable: true };
    descriptors.text = { configurable: true, enumerable: true, get: () => source.text };
  } else if (typeof record.text === 'string') {
    descriptors.text = { value: record.text, writable: true, configurable: true, enumerable: true };
  }
  if (!models) delete descriptors.model;
  if (descriptors.originalSource) descriptors.originalSource.enumerable = false;
  if (record.bytes && copyBytes) descriptors.bytes = { value: record.bytes.slice(), writable: true, configurable: true, enumerable: true };
  return Object.defineProperties({}, descriptors);
}

function withPreparedModel(record, prepared, path) {
  const descriptors = Object.getOwnPropertyDescriptors(cloneWorkspaceRecord(record, path));
  Object.assign(descriptors, Object.getOwnPropertyDescriptors(prepared));
  return Object.defineProperties({}, descriptors);
}

/** URI changes create a new model while sharing the immutable source tree; unchanged records may retain their owned model. */
export function prepareExplorerRecord(record, path = record.path ?? record.uri, { reuseModel = true } = {}) {
  const source = explorerSource(record);
  if (!source) return cloneWorkspaceRecord(captureExplorerRecord(record), path);
  const captured = captureExplorerRecord(record, { models: true, copyBytes: false });
  if (reuseModel && record.model && path === source.uri) return captured;
  if (record.model) return withPreparedModel(captured, rebaseEditorSource(captured, path), path);
  const next = source.uri === path ? source : source.withMetadata({ uri: path });
  const model = new EditorModel(next, { uri: path, version: next.version, encoding: record.encoding, bom: record.bom });
  return preparedExplorerModel(captured, model);
}

/** A replacement model cannot relabel inherited file bytes as its own original source. */
export function preparedExplorerModel(record, model) {
  const path = model.uri;
  const source = model.snapshot();
  const descriptors = Object.getOwnPropertyDescriptors(cloneWorkspaceRecord(record, path));
  Object.assign(descriptors, {
    source: { value: source, configurable: true }, model: { value: model, configurable: true },
    originalSource: { value: record.originalSource, configurable: true }, length: { value: source.length, configurable: true },
    version: { value: source.version, configurable: true, enumerable: true },
    text: { configurable: true, enumerable: true, get: () => model.text, set: text => model.setValue(text) }
  });
  return Object.defineProperties({}, descriptors);
}

export function writeExplorerRecord(record, text) {
  if (typeof text !== 'string' || text.length > studioDiskLimits.maxFileBytes) throw new RangeError('Text item size limit exceeded');
  const source = explorerSource(record);
  if (source) return preparedExplorerModel(record, new EditorModel(text, {
    uri: record.path, version: source.version + 1, encoding: record.encoding, bom: record.bom
  }));
  const result = captureExplorerRecord(record);
  Object.defineProperty(result, 'text', { value: text, configurable: true, enumerable: true, writable: true });
  if (record.version !== undefined) result.version = record.version + 1;
  return result;
}

export function sameExplorerRecord(expected, actual) {
  if (!expected || !actual || expected.path !== actual.path || expected.encoding !== actual.encoding || !!expected.bom !== !!actual.bom) return false;
  const source = explorerSource(actual);
  const previous = explorerSource(expected);
  if (source || previous) return source === previous;
  if (expected.text !== actual.text || expected.bytes?.length !== actual.bytes?.length) return false;
  return !actual.bytes?.some((byte, index) => byte !== expected.bytes[index]);
}

export function explorerRecordSize(record) {
  const source = explorerSource(record);
  return (source?.length ?? record.text?.length ?? 0) * 2 + (record.bytes?.length ?? 0);
}

export function validateExplorerRecords(records) {
  if (records.length > studioDiskLimits.maxFiles) throw new RangeError('Workspace item limit exceeded');
  let size = 0;
  for (const record of records) {
    const source = explorerSource(record);
    if ((source?.length ?? record.text?.length ?? 0) > studioDiskLimits.maxFileBytes) throw new RangeError('Source item size limit exceeded');
    size += explorerRecordSize(record);
  }
  if (size > studioDiskLimits.maxTotalBytes * 2) throw new RangeError('Workspace memory limit exceeded');
  return size;
}
