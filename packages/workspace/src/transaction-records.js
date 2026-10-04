/** Recognize the public immutable UTF-16 snapshot contract without touching a compatibility text getter. */
export function workspaceRecordSource(record) {
  const source = record?.source;
  return source && typeof source === 'object' && Object.isFrozen(source)
    && Number.isSafeInteger(source.length) && source.length >= 0 && typeof source.getText === 'function' ? source : null;
}

function relocatedSource(source, path) {
  if (source.uri === path) return source;
  if (typeof source.withMetadata !== 'function') throw new TypeError('SFW1107: Source snapshot cannot change its URI');
  const next = source.withMetadata({uri: path});
  if (workspaceRecordSource({source: next}) !== next || next.uri !== path || next.length !== source.length) {
    throw new TypeError('SFW1107: Source relocation returned an invalid immutable snapshot');
  }
  return next;
}

/** History owns immutable roots and copied bytes; mutable editor models never enter package transaction state. */
export function cloneWorkspaceRecordSnapshot(record, path = record.path ?? record.uri) {
  const descriptors = Object.getOwnPropertyDescriptors(record);
  delete descriptors.model;
  descriptors.path = {value: path, enumerable: true, writable: true, configurable: true};
  if (descriptors.uri) descriptors.uri = {value: path, enumerable: descriptors.uri.enumerable, configurable: true, writable: true};
  const source = workspaceRecordSource(record);
  if (!source && typeof record?.source?.getText === 'function') throw new TypeError('SFW1107: Source snapshot must be immutable');
  if (source) {
    const current = relocatedSource(source, path);
    descriptors.source = {value: current, configurable: true};
    if (record.originalSource === source) descriptors.originalSource = {value: current, configurable: true};
    descriptors.length = {value: current.length, configurable: true};
    descriptors.version = {value: current.version, enumerable: true, configurable: true};
    descriptors.text = {get: () => current.getText(0, current.length), enumerable: true, configurable: true};
  }
  if (descriptors.originalSource) descriptors.originalSource.enumerable = false;
  if (record.bytes) descriptors.bytes = {value: record.bytes.slice(), writable: true, enumerable: true, configurable: true};
  return Object.defineProperties({}, descriptors);
}

/** Document state containers are copied; their source and baseline roots remain immutable and identity-stable. */
export function cloneWorkspaceDocumentStates(states) {
  if (!(states instanceof Map)) throw new TypeError('SFW1107: Document states must be a Map');
  return new Map([...states].map(([path, state]) => {
    const {source, baseline, ...metadata} = state;
    for (const value of [source, baseline]) {
      if (value != null && typeof value !== 'string' && workspaceRecordSource({source: value}) !== value) {
        throw new TypeError('SFW1107: Document state contains a mutable source');
      }
    }
    return [path, Object.freeze({...structuredClone(metadata), source, baseline})];
  }));
}

export function cloneWorkspaceOperation(operation) {
  const {record, ...metadata} = operation;
  const result = structuredClone(metadata);
  if (record !== undefined) result.record = cloneWorkspaceRecordSnapshot(record, operation.path);
  return result;
}

/** Stage a replacement without mutating the old source root or retaining its live model. */
export function applyWorkspaceRecordWrite(previous, operation, path) {
  const descriptors = {...Object.getOwnPropertyDescriptors(previous ?? {}),
    ...Object.getOwnPropertyDescriptors(operation.record ?? {})};
  const replacementSource = workspaceRecordSource(operation.record);
  const replacementText = Object.getOwnPropertyDescriptor(operation.record ?? {}, 'text')?.value;
  const replacementBytes = operation.bytes ?? operation.record?.bytes;
  let source = replacementSource ?? workspaceRecordSource(previous);
  delete descriptors.model;
  if (operation.text !== undefined) {
    if (typeof operation.text !== 'string') throw new TypeError('File text must be a string');
    if (source) {
      if (typeof source.withChange !== 'function') throw new TypeError('SFW1107: Source snapshot cannot prepare text edits');
      source = source.withChange(0, source.length, operation.text);
      descriptors.source = {value: source, configurable: true};
    } else descriptors.text = {value: operation.text, enumerable: true, configurable: true, writable: true};
  } else if (operation.record && !replacementSource && typeof replacementText === 'string') {
    source = null;
    delete descriptors.source;
  }
  if (replacementBytes !== undefined) {
    if (!(replacementBytes instanceof Uint8Array)) throw new TypeError('File bytes must be Uint8Array');
    descriptors.bytes = {value: replacementBytes.slice(), enumerable: true, configurable: true, writable: true};
    if (operation.text === undefined && !replacementSource && typeof replacementText !== 'string') {
      source = null;
      delete descriptors.source;
      delete descriptors.text;
      delete descriptors.originalText;
    }
  }
  if (!source) {
    delete descriptors.length;
    delete descriptors.originalSource;
  }
  return cloneWorkspaceRecordSnapshot(Object.defineProperties({}, descriptors), path);
}
