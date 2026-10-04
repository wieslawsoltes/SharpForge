import {decodeWorkspaceFile} from '@sharpforge/archive';
import {hashWorkspaceBytes, workspaceRecordBytes} from '@sharpforge/workspace';

const contentFields = ['text', 'bytes', 'originalText', 'encoding', 'bom', 'lossy', 'inferred', 'encodingDiagnostic',
  'lineEndings', 'lineEnding', 'preferredLineEnding', 'finalNewline', 'preserveLineEndings', 'lazy', 'recoveryMissing'];
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const sameBytes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);

function failure(message) {
  const error = new Error('SFW1424: ' + message);
  error.code = 'SFW1424';
  return error;
}

function selectedRecord(source, resolution) {
  const record = {...source};
  for (const key of contentFields) delete record[key];
  const decoded = typeof resolution.content === 'string'
    ? decodeWorkspaceFile(source.path, resolution.bytes, {forceText: true}) : {path: source.path, bytes: resolution.bytes};
  Object.assign(record, decoded);
  if (typeof resolution.content === 'string') {
    if (typeof decoded.text !== 'string') throw failure('Selected bytes are not editable text');
    // Editors may normalize delimiters. Retain the codec metadata needed to reproduce the reviewed bytes on Save.
    record.text = resolution.content;
  }
  record.version = (source.version ?? 0) + 1;
  if (!Number.isSafeInteger(record.version) || record.version < 1) throw failure('Document version space exhausted');
  if (!sameBytes(workspaceRecordBytes(record), resolution.bytes)) throw failure('Selected content does not match its reviewed bytes');
  return record;
}

function unchanged(host, snapshot, source, originalBytes) {
  const current = host.context();
  const record = current.records.find(file => file.path === source.path);
  const protectedDocument = record?.readOnly || record?.generated || current.generated?.some(file => (file.path ?? file.uri) === source.path);
  if (current.identity !== snapshot.identity || current.disk !== snapshot.disk || current.revision !== snapshot.revision ||
      current.readOnly || current.native || !record || protectedDocument || record.version !== source.version || record.text !== source.text ||
      !sameBytes(workspaceRecordBytes(record), originalBytes)) throw failure('Workspace or local document changed during resolution');
  return current;
}

/** Apply a reviewed peer version to buffers only. Physical baselines stay unchanged until an explicit session Save. */
export async function applyWorkspaceConflictResolution(host, session, resolution, {signal, maxBytes = 16 * 1024 * 1024} = {}) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid conflict byte budget');
  if (!resolution || !validHash(resolution.expectedLocalHash) || !validHash(resolution.hash)) {
    throw failure('A reviewed local hash and selected byte hash are required');
  }
  if (typeof resolution.content !== 'string' && !(resolution.content instanceof Uint8Array)) {
    throw failure('Selected content must be text or exact binary bytes');
  }
  if (!(resolution.bytes instanceof Uint8Array) || resolution.bytes.length > maxBytes ||
      typeof resolution.content === 'string' && resolution.content.length * 2 > maxBytes) {
    throw failure('Selected contents exceed the conflict byte budget or lack exact bytes');
  }
  const snapshot = {...host.context()};
  if (snapshot.readOnly) throw failure('The recovered or executing workspace is read-only');
  if (snapshot.native) throw failure('Native peer buffer resolution is unavailable in this host');
  const original = snapshot.records.find(file => file.path === resolution.path);
  if (!original) throw failure('The conflicted document is missing: ' + resolution.path);
  const source = {...original};
  if (source.generated || source.readOnly || snapshot.generated?.some(file => (file.path ?? file.uri) === source.path)) {
    throw failure('Generated and read-only documents cannot accept peer changes');
  }
  if (source.lazy && typeof source.text !== 'string' && !source.bytes) throw failure('Load the conflicted document before resolving it');
  const originalBytes = workspaceRecordBytes(source);
  if (originalBytes.length > maxBytes) throw failure('Local contents exceed the conflict byte budget');
  const selected = {...resolution, bytes: resolution.bytes.slice()};
  if (selected.content instanceof Uint8Array && !sameBytes(selected.content, selected.bytes)) {
    throw failure('Selected binary content does not match its reviewed bytes');
  }
  const record = selectedRecord(source, selected);
  const [originalHash, selectedHash] = await Promise.all([
    hashWorkspaceBytes(originalBytes, {signal}), hashWorkspaceBytes(selected.bytes, {signal})
  ]);
  if (originalHash !== selected.expectedLocalHash) throw failure('Local document hash changed after the conflict was presented');
  if (selectedHash !== selected.hash) throw failure('Selected bytes do not match the reviewed hash');
  const current = unchanged(host, snapshot, source, originalBytes);
  signal?.throwIfAborted();
  await session.commit({records: current.records.map(file => file.path === source.path ? record : file),
    folders: current.folders, dirty: [...new Set([...(current.dirty ?? []), source.path])], preserveMembership: true});
  return {path: source.path, hash: selectedHash, dirty: true, revision: host.context().revision};
}
