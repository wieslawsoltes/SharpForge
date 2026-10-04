import {cloneWorkspaceRecordSnapshot, workspaceRecordSource, workspaceRecordBytes} from '@sharpforge/workspace';

const bytesIdentity = record => record?.observedBytes ?? record?.bytes;

/** Compare captured immutable roots and encoding metadata without reading their full text views. */
export function sameRevisionContents(left, right) {
  if (!left || !right) return false;
  const leftSource = workspaceRecordSource(left);
  const rightSource = workspaceRecordSource(right);
  return (leftSource || rightSource ? leftSource === rightSource : left.text === right.text)
    && bytesIdentity(left) === bytesIdentity(right) && (leftSource?.version ?? left.version) === (rightSource?.version ?? right.version)
    && left.encoding === right.encoding && left.bom === right.bom && left.originalSource === right.originalSource
    && left.originalText === right.originalText && left.lineEndings === right.lineEndings
    && left.preferredLineEnding === right.preferredLineEnding && left.preserveLineEndings === right.preserveLineEndings;
}

export function captureRevisionRecord(record) {
  const captured = cloneWorkspaceRecordSnapshot(record);
  Object.defineProperty(captured, 'observedBytes', {value: record.bytes});
  return captured;
}

/** Conflict choices explicitly materialize bounded content; ordinary revision observation keeps source roots lazy. */
export function readRevisionContent(value, {maxBytes = 16 * 1024 * 1024, signal} = {}) {
  signal?.throwIfAborted();
  if (typeof value === 'string') {
    if (value.length * 2 > maxBytes) throw new RangeError('SFW1426: Peer content exceeds the conflict byte limit');
    return value;
  }
  if (value instanceof Uint8Array) {
    if (value.length > maxBytes) throw new RangeError('SFW1426: Peer content exceeds the conflict byte limit');
    return value.slice();
  }
  const source = workspaceRecordSource(value);
  const length = source?.length ?? value?.text?.length ?? 0;
  if (length * 2 > maxBytes) throw new RangeError('SFW1426: Peer content exceeds the conflict byte limit');
  if (source) return source.getText(0, source.length);
  if (typeof value?.text === 'string') return value.text;
  return workspaceRecordBytes(value, {maxBytes}).slice();
}
