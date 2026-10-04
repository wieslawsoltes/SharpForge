import {decodeWorkspaceFile} from '@sharpforge/archive';
import {cloneWorkspaceRecord, validatePreparedRecord} from '../workspace-records.js';

export function checkReadCancellation(signal) {
  if (signal?.aborted) throw new DOMException('Workspace read cancelled', 'AbortError');
}

/** Reader ownership lasts until the whole file batch succeeds. Failed batches dispose only their own prepared models. */
export function disposePreparedRecords(records) {
  for (const record of records) record.model?.dispose();
}

export function sourceReaderOptions(options) {
  if (options.readSource !== undefined && typeof options.readSource !== 'function') throw new TypeError('Invalid source reader');
  return {readSource: options.readSource, signal: options.signal};
}

export async function readWorkspaceFile(file, path, limits, {readSource, signal, encoding, maxCharacters} = {}) {
  checkReadCancellation(signal);
  if (/\.cs$/i.test(path) && readSource) {
    if (file.size > limits.maxFileBytes) throw new Error('Source file limit exceeded by ' + path);
    return readPreparedSource(file, path, limits, {readSource, signal, encoding, maxCharacters});
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  checkReadCancellation(signal);
  if (bytes.length !== file.size) throw new Error('File changed while being read: ' + path);
  const record = decodeKnownSource(path, bytes, encoding);
  if (/\.cs$/i.test(path) && typeof record.text === 'string' && bytes.length > limits.maxFileBytes) {
    throw new Error('Source file limit exceeded by ' + path);
  }
  return record;
}

async function readPreparedSource(file, path, limits, options) {
  let prepared;
  try {
    prepared = await options.readSource(file, {path, signal: options.signal, limits,
      encoding: options.encoding, maxCharacters: options.maxCharacters});
    checkReadCancellation(options.signal);
    validatePreparedRecord(prepared, path, {byteLength: file.size, maximum: limits.maxFileBytes});
    return cloneWorkspaceRecord(prepared, path);
  } catch (error) {
    prepared?.model?.dispose();
    throw error;
  }
}

/** A known no-BOM encoding is retained on later baseline reads; ordinary ingress still uses archive detection. */
export function decodeKnownSource(path, bytes, encoding) {
  const record = decodeWorkspaceFile(path, bytes);
  if (encoding === undefined || record.encoding === encoding) return record;
  if (!['utf-8', 'utf-16le', 'utf-16be'].includes(encoding)) throw new TypeError('Unsupported text encoding');
  const marker = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be'
    : bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191 ? 'utf-8' : null;
  if (marker && marker !== encoding) throw new TypeError('Source BOM conflicts with the saved encoding: ' + path);
  const text = new TextDecoder(encoding, {fatal: true}).decode(bytes);
  if (text.includes('\0')) throw new TypeError('Disk source changed to binary: ' + path);
  return {...record, text, originalText: text, encoding, bom: marker !== null};
}
