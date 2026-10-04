import {isSourceSnapshot} from '@sharpforge/project-system';
import {captureExplorerRecord, explorerSource} from '../explorer-records.js';

const contentFields = new Set(['text', 'source', 'model', 'originalSource', 'length', 'version', 'bytes', 'byteLength',
  'originalText', 'nativeBaseline', 'nativeHash']);
const mutable = value => ({value, enumerable: true, configurable: true, writable: true});

export const nativeRecordSource = record => explorerSource(record) ?? record?.text;

/** Compare snapshot ranges without reading a complete compatibility text getter. */
export function sameNativeContent(left, right) {
  if (left === right) return true;
  if ((typeof left !== 'string' && !isSourceSnapshot(left)) || (typeof right !== 'string' && !isSourceSnapshot(right))) return false;
  if (left.length !== right.length) return false;
  for (let start = 0; start < left.length; start += 65_536) {
    const end = Math.min(left.length, start + 65_536);
    const a = typeof left === 'string' ? left.slice(start, end) : left.getText(start, end);
    const b = typeof right === 'string' ? right.slice(start, end) : right.getText(start, end);
    if (a !== b) return false;
  }
  return true;
}

export function nativeRecordIsDirty(record, documents) {
  const uri = record?.uri ?? record?.path;
  if (documents?.get(uri)) return documents.dirtyFiles.has(uri);
  return record?.nativeBaseline !== undefined && !sameNativeContent(nativeRecordSource(record), record.nativeBaseline);
}

/** Preserve the legacy plain-record shape while prepared records retain immutable roots instead of live models. */
export function captureNativeRecord(record, {models = false} = {}) {
  const copy = captureExplorerRecord(record, {models, copyBytes: false});
  if (!Object.hasOwn(record, 'path')) delete copy.path;
  return copy;
}

/** Select an incoming disk snapshot or a retained dirty owner before any document state is changed. */
export function nativeRecordFromRead(record, previous, {documents, path = record.uri ?? record.path, preserveDirty = true} = {}) {
  const remote = nativeRecordSource(record);
  if (typeof remote !== 'string' && !isSourceSnapshot(remote)) throw new TypeError('Native source input must contain text');
  const readOnly = record.readOnly === true || record.generated === true;
  const retainedDirty = !!previous && preserveDirty && !readOnly && nativeRecordIsDirty(previous, documents);
  const unchanged = !!previous && sameNativeContent(nativeRecordSource(previous), remote);
  const chosen = retainedDirty || unchanged ? previous : record;
  const descriptors = Object.getOwnPropertyDescriptors(captureNativeRecord(chosen, {models: true}));
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(record))) {
    if (!contentFields.has(key)) descriptors[key] = {...descriptor, configurable: true};
  }
  const version = retainedDirty || unchanged ? previous.version ?? 1 : previous ? (previous.version ?? 0) + 1 : record.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('Native document version is invalid');
  const source = nativeRecordSource(chosen);
  if (isSourceSnapshot(source) && (source.uri !== path || source.version !== version)) {
    const rebased = source.withMetadata({uri: path, version});
    descriptors.source = {value: rebased, configurable: true};
    descriptors.length = {value: rebased.length, configurable: true};
    descriptors.text = {enumerable: true, configurable: true, get: () => rebased.getText(0, rebased.length)};
    if (chosen.originalSource === source) descriptors.originalSource = {value: rebased, configurable: true};
    delete descriptors.model;
  }
  Object.assign(descriptors, {
    path: mutable(path), uri: mutable(path), version: mutable(version),
    nativeHash: mutable(retainedDirty ? previous.nativeHash : record.hash ?? record.nativeHash ?? null),
    nativeBaseline: mutable(retainedDirty ? previous.nativeBaseline : remote),
    readOnly: mutable(readOnly), generated: mutable(record.generated === true)
  });
  return {record: Object.defineProperties({}, descriptors), retainedDirty};
}

/** Status queries stay lazy; the save consumer reads only the immutable changed revisions it captured. */
export function collectNativeSourceChanges(state, documents) {
  if (!state.nativeMode) return [];
  const changes = [];
  for (const record of documents?.files ?? state.files) {
    if (!record.nativeHash || record.readOnly || record.generated || !nativeRecordIsDirty(record, documents)) continue;
    const source = nativeRecordSource(record);
    changes.push({path: record.uri ?? record.path, expectedHash: record.nativeHash,
      get text() { return typeof source === 'string' ? source : source.getText(0, source.length); }});
  }
  return changes;
}

export function nativeWorkspaceIdentity(state) {
  return JSON.stringify([state.nativeMode === true, state.nativeWorkspace?.root ?? null, state.workspaceEpoch ?? 0]);
}

export function checkNativeOwnership(state, identity, signal) {
  signal?.throwIfAborted();
  if (!state.nativeMode || nativeWorkspaceIdentity(state) !== identity) {
    throw new DOMException('Native workspace changed before document adoption', 'AbortError');
  }
}
