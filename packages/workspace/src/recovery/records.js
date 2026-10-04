import {validateWorkspacePath} from '../transaction-state.js';
import {cloneWorkspaceRecordSnapshot, workspaceRecordSource} from '../transaction-records.js';

const identity = path => path.normalize('NFC').toLowerCase();
const invalid = message => new Error('SFW1302: ' + message);

function recordsFrom(value) {
  if (Array.isArray(value.diskRecords)) return value.diskRecords;
  if (Array.isArray(value.records)) return value.records;
  if (Array.isArray(value.files)) return value.files;
  if (value.files && typeof value.files === 'object') {
    return Object.entries(value.files).map(([path, contents]) => typeof contents === 'string' ?
      {path, text: contents} : cloneWorkspaceRecordSnapshot(contents, path));
  }
  if (Array.isArray(value.documents)) return value.documents;
  return [];
}

function restoreBytes(file) {
  if (file.bytes instanceof Uint8Array) return file.bytes.slice();
  if (Array.isArray(file.bytes)) {
    if (file.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw invalid('Invalid recovery bytes');
    return Uint8Array.from(file.bytes);
  }
  if (file.base64 !== undefined) {
    if (typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)) {
      throw invalid('Invalid recovery byte encoding');
    }
    return Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
  }
  if (file.bytes !== undefined) throw invalid('Invalid recovery bytes');
}

function restoreRecord(file) {
  const path = validateWorkspacePath(file.path ?? file.uri);
  const record = {path};
  const source = workspaceRecordSource(file);
  for (const name of ['text', 'originalText', 'encoding', 'hash', 'preferredLineEnding', 'encodingDiagnostic', 'recoveryMissing']) {
    if (source && name === 'text') continue;
    if (file[name] !== undefined) {
      if (typeof file[name] !== 'string') throw invalid('Invalid ' + name + ' for ' + path);
      record[name] = file[name];
    }
  }
  for (const name of ['bom', 'dirty', 'compile', 'lossy', 'inferred', 'preserveLineEndings', 'readOnly', 'generated']) {
    if (file[name] !== undefined) {
      if (typeof file[name] !== 'boolean') throw invalid('Invalid ' + name + ' for ' + path);
      record[name] = file[name];
    }
  }
  for (const name of ['version', 'size', 'byteLength', 'lastModified', 'mtime', 'mode']) {
    if (file[name] !== undefined) {
      if (!Number.isSafeInteger(file[name]) || file[name] < 0) throw invalid('Invalid ' + name + ' for ' + path);
      record[name] = file[name];
    }
  }
  if (file.lineEndings !== undefined) {
    if (!Array.isArray(file.lineEndings) || file.lineEndings.some(value => !['\n', '\r', '\r\n'].includes(value))) {
      throw invalid('Invalid line endings for ' + path);
    }
    record.lineEndings = [...file.lineEndings];
  }
  const bytes = restoreBytes(file);
  if (bytes) record.bytes = bytes;
  if (source) {
    Object.defineProperty(record, 'source', {value: source, configurable: true});
    if (file.originalSource) Object.defineProperty(record, 'originalSource', {value: file.originalSource, configurable: true});
  }
  if (!source && typeof record.text !== 'string' && !bytes) {
    if (file.lazy !== true || !Number.isSafeInteger(file.size) || file.size < 0) throw invalid('Missing recovery contents: ' + path);
    record.lazy = true;
  }
  return source ? cloneWorkspaceRecordSnapshot(record, path) : record;
}

/** Preserve membership and byte spelling; explicitly unloaded files count as metadata rather than invented empty buffers. */
export function restoreRecoveryRecords(source, {maxFiles, maxBytes, signal}) {
  const inputs = recordsFrom(source);
  if (inputs.length > maxFiles) throw new Error('SFW1304: Recovery file limit exceeded');
  const records = new Map();
  for (const input of inputs) {
    signal?.throwIfAborted();
    const path = validateWorkspacePath(input.path ?? input.uri);
    const key = identity(path);
    if (records.has(key)) throw invalid('Duplicate recovery path: ' + path);
    records.set(key, cloneWorkspaceRecordSnapshot(input, path));
  }
  // Historical snapshots could keep disk membership and newer editor versions in separate arrays.
  const overlays = source.diskRecords || source.records ? source.files : null;
  for (const input of [...(source.extraFiles ?? []), ...(Array.isArray(overlays) ? overlays : [])]) {
    signal?.throwIfAborted();
    const path = validateWorkspacePath(input.path ?? input.uri);
    const key = identity(path);
    const existing = records.get(key);
    const descriptors = {...Object.getOwnPropertyDescriptors(existing ?? {}), ...Object.getOwnPropertyDescriptors(input)};
    if (!workspaceRecordSource(input) && typeof Object.getOwnPropertyDescriptor(input, 'text')?.value === 'string') {
      delete descriptors.source;
      delete descriptors.originalSource;
    }
    records.set(key, cloneWorkspaceRecordSnapshot(Object.defineProperties({}, descriptors), existing?.path ?? path));
  }
  if (records.size > maxFiles) throw new Error('SFW1304: Recovery file limit exceeded');
  let size = 0;
  const result = [];
  for (const input of records.values()) {
    signal?.throwIfAborted();
    const record = restoreRecord(input);
    size += (record.path.length + (workspaceRecordSource(record)?.length ?? record.text?.length ?? 0) + (record.originalText?.length ?? 0)) * 2 +
      (record.bytes?.length ?? 0) + (record.lineEndings?.length ?? 0) * 4;
    if (size > maxBytes) throw new Error('SFW1304: Recovery byte limit exceeded');
    result.push(record);
  }
  return {records: result, paths: new Map(result.map(record => [identity(record.path), record.path]))};
}
