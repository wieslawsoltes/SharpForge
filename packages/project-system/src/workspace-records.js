import {normalizePath} from './paths.js';

/** Immutable source snapshots are supplied through a contribution; project-system never imports an editor. */
export function isSourceSnapshot(source) {
  return !!source && typeof source === 'object' && Object.isFrozen(source)
    && Number.isSafeInteger(source.length) && source.length >= 0 && typeof source.getText === 'function';
}

/** Return a contributed immutable source snapshot, or null, without reading the record's text getter. */
export function recordSource(record) {
  return isSourceSnapshot(record?.source) ? record.source : null;
}

/** Recognize a source snapshot or a legacy string record; prepared snapshots avoid a compatibility text read. */
export function isTextRecord(record) {
  return !!record && (recordSource(record) !== null || typeof record.text === 'string');
}

/** This explicit text read is for compilation/export, not project membership or document adoption. */
export function recordText(record) {
  const source = recordSource(record);
  return source ? source.getText(0, source.length) : record?.text;
}

/** Clone descriptors at the supplied path without materializing text or transferring/rebasing source-model ownership. */
export function cloneWorkspaceRecord(record, path) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  descriptors.path = {value: path, writable: true, configurable: true, enumerable: true};
  if (descriptors.uri) descriptors.uri = {value: path, writable: true, configurable: true, enumerable: descriptors.uri.enumerable};
  for (const key of ['model', 'source', 'originalSource']) {
    if (descriptors[key]) descriptors[key].enumerable = false;
  }
  return Object.defineProperties({}, descriptors);
}

export function validatePreparedRecord(record, path, {byteLength = record?.byteLength, maximum = Number.MAX_SAFE_INTEGER} = {}) {
  const source = record?.source;
  const model = record?.model;
  if (!isSourceSnapshot(source) || record.path !== path || source.uri !== path || model?.uri !== path
    || typeof model.snapshot !== 'function' || typeof model.dispose !== 'function'
    || source !== model.snapshot() || source.version !== model.version || source.length !== model.length
    || !Number.isSafeInteger(record.byteLength) || record.byteLength < 0 || record.byteLength !== byteLength
    || source.length > maximum) {
    throw new TypeError('The source contribution returned an invalid prepared document: ' + path);
  }
  return record;
}

export function projectFileMap(files, maximum) {
  const input = files instanceof Map ? [...files].map(([path, value]) => typeof value === 'string'
    ? {path, text: value} : cloneWorkspaceRecord(value, path)) : files;
  if (!Array.isArray(input) || input.length > maximum) throw new Error('Workspace file limit exceeded');
  const result = new Map();
  for (const record of input) {
    const path = normalizePath(record.path ?? record.uri);
    if (result.has(path)) throw new Error(`Duplicate workspace path: ${path}`);
    if (!isTextRecord(record) && !(record.bytes instanceof Uint8Array)) throw new Error(`No file contents: ${path}`);
    result.set(path, cloneWorkspaceRecord(record, path));
  }
  return result;
}

/** Preserve the legacy enumerable compilation shape while deferring whole-source materialization. */
export function compilationRecords(paths, files) {
  return [...paths].filter(path => isTextRecord(files.get(path))).map(uri => {
    const file = files.get(uri);
    const result = {uri, version: file.version ?? 1};
    const descriptors = {
      text: {enumerable: true, get: () => recordText(file)},
      source: {get: () => recordSource(file)},
      length: {get: () => recordSource(file)?.length ?? file.text.length}
    };
    for (const key of ['model', 'encoding', 'bom', 'byteLength']) {
      if (key in file) descriptors[key] = {value: file[key]};
    }
    return Object.defineProperties(result, descriptors);
  });
}
