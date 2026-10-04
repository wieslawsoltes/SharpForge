import { encodedWorkspaceSourceChunks, isSourceSnapshot } from '@sharpforge/project-system';

/** Studio opts into large source buffers; callers outside Studio retain the project-system defaults. */
export const studioDiskLimits = Object.freeze({
  maxFiles: 20_000,
  maxFileBytes: 256 * 1024 * 1024,
  maxAssemblyBytes: 256 * 1024 * 1024,
  maxTotalBytes: 320 * 1024 * 1024
});

/** Validate decoded source lengths in UTF-16 code units before replacing the current workspace. */
export function validateStudioSources(sources) {
  if (!Array.isArray(sources) || sources.length > studioDiskLimits.maxFiles) {
    throw new RangeError('Studio supports at most 20,000 source files in one workspace');
  }
  let total = 0;
  for (const source of sources) {
    const length = studioSourceLength(source);
    if (length > studioDiskLimits.maxFileBytes) throw new RangeError('A source exceeds the editor buffer limit');
    total += length;
    if (total > studioDiskLimits.maxTotalBytes) throw new RangeError('The workspace exceeds the total source buffer limit');
  }
  return sources;
}

/** Prepared sources expose metadata without materializing their complete text. DocumentService checks ownership on adoption. */
export function studioSourceLength(record) {
  if (record?.model || isSourceSnapshot(record?.source)) {
    const source = record.source ?? record.model.snapshot();
    if (!Number.isSafeInteger(source?.length) || source.length < 0) throw new TypeError('Invalid prepared source length');
    return source.length;
  }
  if (typeof record?.text !== 'string') throw new TypeError('A source document must contain text');
  return record.text.length;
}

export function isStudioTextRecord(record) {
  return Boolean(record?.model) || isSourceSnapshot(record?.source) || typeof record?.text === 'string';
}

/** Metadata-only entries are admitted only by callers that can load the original bytes or recover without I/O. */
export function isStudioLazyRecord(record) {
  return record?.lazy === true && Number.isSafeInteger(record.size) && record.size >= 0
    && !record.source && !record.model && !record.bytes && Object.getOwnPropertyDescriptor(record, 'text') === undefined;
}

/** Count the whole workspace, including encoded source bytes and binary assets, before an ownership transaction commits. */
export async function validateStudioWorkspaceRecords(records, { signal, limits = studioDiskLimits, allowLazy = false } = {}) {
  if (!Array.isArray(records) || records.length > limits.maxFiles) {
    throw new RangeError('Studio supports at most 20,000 files in one workspace');
  }
  validateStudioSources(records.filter(isStudioTextRecord));
  const byteLengths = new Map();
  let total = 0;
  for (const record of records) {
    if (signal?.aborted) throw new DOMException('Workspace validation cancelled', 'AbortError');
    if (record.lazy && (!allowLazy || !isStudioLazyRecord(record))) {
      throw new TypeError('Unloaded workspace files require explicit metadata and an authorized source provider');
    }
    const bytes = await studioRecordByteLength(record, signal, limits.maxFileBytes);
    byteLengths.set(record, bytes);
    if (bytes > limits.maxFileBytes) throw new RangeError('A workspace file exceeds the encoded file byte limit');
    if (!record.lazy) total += bytes;
    if (total > limits.maxTotalBytes) throw new RangeError('The workspace exceeds the total encoded byte limit');
  }
  return { records, byteLengths };
}

async function studioRecordByteLength(record, signal, maxBytes) {
  if (isStudioLazyRecord(record)) return record.size;
  const prepared = record.source ?? record.model?.snapshot();
  if (!isSourceSnapshot(prepared) && record.bytes instanceof Uint8Array) return record.bytes.byteLength;
  const source = prepared ?? record.text;
  // Raw ingress metadata belongs only to its original source root; edits require a fresh bounded encoding count.
  if (isSourceSnapshot(source) && source === record.originalSource
      && Number.isSafeInteger(record.byteLength) && record.byteLength >= 0) return record.byteLength;
  let bytes = 0;
  for await (const chunk of encodedWorkspaceSourceChunks(source, {
    path: record.path ?? record.uri, encoding: record.encoding, bom: record.bom, signal,
    maxBytes
  })) bytes += chunk.byteLength;
  return bytes;
}
