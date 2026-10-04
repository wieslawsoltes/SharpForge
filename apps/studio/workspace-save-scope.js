import {recordSource, decodeWorkspaceFile} from '@sharpforge/project-system';
import {hashWorkspaceRecord, workspaceRecordBytes} from '@sharpforge/workspace';
import {captureExplorerRecord, sameExplorerRecord} from './explorer-records.js';

/** Limit document saves to their captured inputs while observing the real workspace for reconciliation. */
export function workspaceSaveScope(host, options) {
  const initial = host.context();
  const workspaceDisk = host.state.disk;
  const disk = options.disk ?? workspaceDisk;
  const nativeMode = host.state.nativeMode;
  const scoped = Object.create(host);
  scoped.saveDisk = disk;
  scoped.reconcileDocuments = options.captures === undefined;
  scoped.acknowledged = options.captures?.map(record => record.path ?? record.uri);
  scoped.checkSave = () => {
    options.signal?.throwIfAborted();
    options.check?.();
    if (host.state.disk !== workspaceDisk || host.state.nativeMode !== nativeMode || host.context().identity !== initial.identity) {
      throw new Error('Workspace changed while saving; current buffers were preserved');
    }
  };
  scoped.context = () => ({...host.context(), disk});
  return scoped;
}

function capturedRecord(record, snapshot) {
  if (!snapshot) return captureExplorerRecord(record, {copyBytes: false});
  const descriptors = {...Object.getOwnPropertyDescriptors(record ?? {}), ...Object.getOwnPropertyDescriptors(snapshot)};
  descriptors.path = {value: snapshot.path ?? snapshot.uri, configurable: true, enumerable: true};
  delete descriptors.model;
  if (!recordSource(snapshot)) {
    delete descriptors.source;
    delete descriptors.originalSource;
  }
  return captureExplorerRecord(Object.defineProperties({}, descriptors), {copyBytes: false});
}

/** Preserve captured source roots until the provider's bounded physical encoding phase. */
export async function workspaceSaveInputs(context, {signal, captures, wholeWorkspace = true, excludedPaths = []} = {}) {
  if (captures !== undefined && (!Array.isArray(captures) || captures.length > (context.disk.options?.maxFiles ?? 20000))) {
    throw new TypeError('Save captures must be a bounded document list');
  }
  const selected = new Map();
  for (const capture of captures ?? []) {
    const path = capture.path ?? capture.uri;
    if (selected.has(path)) throw new TypeError('A document may only appear once in a save capture');
    selected.set(path, capture);
  }
  const records = new Map(context.records.map(record => [record.path, record]));
  const excluded = new Set(excludedPaths);
  for (const path of selected.keys()) if (!records.has(path)) throw new Error('The captured document no longer exists: ' + path);
  const inputs = [];
  for (const record of context.records) {
    signal?.throwIfAborted();
    if (excluded.has(record.path) || !wholeWorkspace && !selected.has(record.path) || record.lazy && !recordSource(record)) continue;
    const captured = capturedRecord(record, selected.get(record.path));
    const hash = await hashWorkspaceRecord(captured, {signal});
    let baseline = context.disk.baselineHashes.get(record.path);
    const physical = context.disk.record(record.path);
    if (baseline === undefined && physical && !physical.lazy) {
      const hash = await hashWorkspaceRecord(physical, {signal});
      if (!context.disk.baselineHashes.has(record.path)) context.disk.baselineHashes.set(record.path, hash);
      baseline = context.disk.baselineHashes.get(record.path);
    }
    if (baseline === hash) continue;
    inputs.push({path: record.path, record: captured, hash, expectedHash: baseline ?? null, version: captured.version});
  }
  return inputs;
}

export function sameSaveRecord(left, right) {
  return left?.version === right?.version && sameExplorerRecord(left, right);
}

export function saveRecordChange(record, expectedHash) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  delete descriptors.model;
  descriptors.expectedHash = {value: expectedHash, enumerable: true, configurable: true};
  return Object.defineProperties({}, descriptors);
}

/** A reviewed complete replacement sheds stale model/source descriptors while retaining encoding and file metadata. */
export function replaceSaveRecord(previous, replacement, version) {
  const descriptors = {...Object.getOwnPropertyDescriptors(previous ?? {}), ...Object.getOwnPropertyDescriptors(replacement)};
  for (const key of ['model', 'source', 'length', 'originalSource']) delete descriptors[key];
  if (typeof replacement.text !== 'string') {
    delete descriptors.text;
    delete descriptors.originalText;
  }
  descriptors.version = {value: version, enumerable: true, configurable: true};
  descriptors.lazy = {value: false, enumerable: true, configurable: true};
  return Object.defineProperties({}, descriptors);
}

/** Partial document baselines describe bytes actually committed, including reviewed text merges. */
export function savedWorkspaceCaptures(plan, written) {
  const pending = new Map((plan?.pending ?? []).map(change => [change.path, change]));
  const versions = new Map((plan?.inputs ?? []).map(input => [input.path, input.version]));
  return (written ?? []).filter(path => pending.has(path)).map(uri => {
    const record = pending.get(uri);
    const source = recordSource(record);
    if (source) return {uri, source, version: source.version};
    const decoded = decodeWorkspaceFile(uri, workspaceRecordBytes(record));
    return {uri, text: decoded.text, version: versions.get(uri)};
  });
}
