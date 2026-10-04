import {normalizePath} from '../paths.js';
import {recordSource, isTextRecord, isSourceSnapshot} from '../workspace-records.js';
import {checkReadCancellation, readWorkspaceFile} from './source-reader.js';
import {contentLength, sourceByteLength, equalSourceContent} from './source-content.js';

function observationError(message) {
  const error = new Error(message);
  error.code = 'SFPROJECT_DISK_OBSERVATION_STALE';
  return error;
}

/** Capture immutable content before joining the existing save queue. No caller-owned record is mutated. */
export function captureBaselineObservation(path, observed, options) {
  path = normalizePath(path);
  const content = recordSource(observed) ?? observed?.text;
  contentLength(content);
  const encoding = observed.encoding ?? 'utf-8';
  if (!['utf-8', 'utf-16le', 'utf-16be'].includes(encoding) || typeof observed.bom !== 'boolean'
    || !Number.isSafeInteger(observed.byteLength) || observed.byteLength < 0
    || !Number.isSafeInteger(options.expectedVersion) || options.expectedVersion < 0
    || !options.expectedHandle || options.check !== undefined && typeof options.check !== 'function'
    || options.commit !== undefined && typeof options.commit !== 'function') {
    throw new TypeError('Invalid disk baseline observation');
  }
  return {path, content, encoding, bom: observed.bom, byteLength: observed.byteLength,
    expectedVersion: options.expectedVersion, expectedHandle: options.expectedHandle,
    signal: options.signal, check: options.check, commit: options.commit};
}

function checkObservation(workspace, observed) {
  checkReadCancellation(observed.signal);
  if (!workspace.byPath.has(observed.path) || workspace.handles.get(observed.path) !== observed.expectedHandle
    || workspace.getVersion(observed.path) !== observed.expectedVersion || observed.check?.() === false) {
    throw observationError('The file target or saved version changed after the disk observation: ' + observed.path);
  }
}

function stageObservedRecord(workspace, observed) {
  const record = workspace.byPath.get(observed.path);
  const index = workspace.records.indexOf(record);
  if (index < 0 || Object.getOwnPropertyDescriptor(workspace.records, String(index))?.writable === false) {
    throw new TypeError('The disk record list cannot accept an observed version');
  }
  // Build a detached descriptor record so a caller-supplied setter cannot mutate documents during host preparation.
  const descriptors = Object.getOwnPropertyDescriptors(record);
  delete descriptors.model;
  const source = observed.content;
  descriptors.text = {enumerable: true, configurable: true,
    get() { return typeof this.source === 'string' ? this.source : this.source.getText(0, this.source.length); },
    set(value) {
      if (typeof value !== 'string') throw new TypeError('Disk record text must be a string');
      this.source = value;
    }};
  descriptors.source = {value: source, writable: true, configurable: true, enumerable: false};
  descriptors.originalSource = {value: source, configurable: true, enumerable: false};
  descriptors.length = {get() { return this.source.length; }, configurable: true, enumerable: false};
  descriptors.version = {value: isSourceSnapshot(source) ? source.version ?? record.version : record.version,
    writable: true, configurable: true, enumerable: true};
  for (const name of ['encoding', 'bom', 'byteLength']) {
    descriptors[name] = {value: observed[name], writable: true, configurable: true, enumerable: true};
  }
  return {index, record: Object.defineProperties({}, descriptors)};
}

async function verifyObservedFile(workspace, observed) {
  const file = await observed.expectedHandle.getFile();
  checkObservation(workspace, observed);
  if (file.size !== observed.byteLength) throw observationError('The file changed after the disk observation: ' + observed.path);
  const current = await readWorkspaceFile(file, observed.path, workspace.limits, {
    readSource: workspace.readSource, signal: observed.signal, encoding: observed.encoding,
    maxCharacters: Math.max(1, contentLength(observed.content))
  });
  try {
    checkObservation(workspace, observed);
    if (!isTextRecord(current) || (current.encoding ?? 'utf-8') !== observed.encoding
      || Boolean(current.bom) !== observed.bom
      || !await equalSourceContent(recordSource(current) ?? current.text, observed.content, {signal: observed.signal})) {
      throw observationError('The file changed after the disk observation: ' + observed.path);
    }
  } finally { current.model?.dispose(); }
}

function commitObservation(workspace, observed) {
  const replacement = stageObservedRecord(workspace, observed);
  let accepted = false;
  let active = true;
  const result = {path: observed.path, version: observed.expectedVersion + 1, byteLength: observed.byteLength};
  const accept = () => {
    if (!active || accepted) throw new Error('A disk baseline must be accepted exactly once during synchronous commit');
    checkObservation(workspace, observed);
    workspace.records[replacement.index] = replacement.record;
    workspace.byPath.set(observed.path, replacement.record);
    workspace.baseline.set(observed.path, observed.content);
    workspace.sizes.set(observed.path, observed.byteLength);
    workspace.versions.set(observed.path, result.version);
    accepted = true;
    return result;
  };
  try {
    const committed = observed.commit ? observed.commit(accept) : accept();
    if (committed && typeof committed.then === 'function') {
      // A rejected late callback cannot become an unhandled rejection or reopen this completed commit window.
      committed.catch(() => {});
      throw new TypeError('Disk baseline commit callbacks must be synchronous');
    }
    if (!accepted) throw new Error('Disk baseline commit callback did not accept the validated observation');
    return result;
  } catch (error) {
    if (accepted) error.committed = true;
    throw error;
  } finally { active = false; }
}

/** Recheck actual bytes and source before atomically accepting a caller-confirmed external version. */
export async function acceptBaselineObservation(workspace, observed) {
  checkObservation(workspace, observed);
  const maximum = Math.min(workspace.limits.maxFileBytes, workspace.limits.maxAssemblyBytes);
  if (observed.byteLength > maximum) throw new RangeError('Observed source file byte limit exceeded');
  const bytes = await sourceByteLength(observed.content, observed, maximum, {signal: observed.signal});
  if (bytes !== observed.byteLength) throw new TypeError('Observed source encoding and byte length disagree');
  const total = [...workspace.sizes.values()].reduce((sum, size) => sum + size, 0)
    - (workspace.sizes.get(observed.path) ?? 0) + bytes;
  if (total > workspace.limits.maxTotalBytes) throw new RangeError('Observed workspace total byte limit exceeded');
  checkObservation(workspace, observed);
  await verifyObservedFile(workspace, observed);
  checkObservation(workspace, observed);
  return commitObservation(workspace, observed);
}
