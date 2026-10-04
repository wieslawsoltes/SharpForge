import {encodeWorkspaceFile} from '@sharpforge/archive';
import {encodedLength} from './limits.js';
import {isSourceSnapshot, recordSource} from '../workspace-records.js';
import {validateSourceEncoding} from './source-validity.js';
import {checkReadCancellation} from './source-reader.js';

const CHUNK_CHARACTERS = 64 * 1024;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

export function contentLength(content) {
  if (typeof content === 'string' || isSourceSnapshot(content)) return content.length;
  throw new TypeError('Save content must be text or an immutable source snapshot');
}

function contentPart(content, start, end) {
  return typeof content === 'string' ? content.slice(start, end) : content.getText(start, end);
}

/** Each encoding chunk retains complete surrogate pairs, including pairs split between persistent pieces. */
function* contentChunks(content) {
  const length = contentLength(content);
  if (!length) {
    yield '';
    return;
  }
  for (let start = 0; start < length;) {
    let end = Math.min(length, start + CHUNK_CHARACTERS);
    if (end < length) {
      const boundary = contentPart(content, end - 1, end + 1);
      if (boundary.charCodeAt(0) >= 0xd800 && boundary.charCodeAt(0) <= 0xdbff
        && boundary.charCodeAt(1) >= 0xdc00 && boundary.charCodeAt(1) <= 0xdfff) end++;
    }
    yield contentPart(content, start, end);
    start = end;
  }
}

export function initialRecordSize(record) {
  if (!recordSource(record)) return encodedLength(record);
  if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 0) throw new TypeError('Prepared source byte length is required');
  return record.byteLength;
}

export async function sourceByteLength(content, record, maximum, {signal} = {}) {
  checkReadCancellation(signal);
  const length = contentLength(content);
  if (length > maximum) throw new Error('Invalid save text');
  const encoding = record.encoding ?? 'utf-8';
  let bytes = record.bom ? encoding === 'utf-8' ? 3 : 2 : 0;
  if (!['utf-8', 'utf-16le', 'utf-16be'].includes(encoding)) throw new TypeError('Unsupported text encoding');
  let offset = 0;
  for (const text of contentChunks(content)) {
    checkReadCancellation(signal);
    validateSourceEncoding(text, {path: record.path, offset, bom: record.bom});
    bytes += encodedLength({encoding, bom: false}, text);
    if (bytes > maximum) return bytes;
    offset += text.length;
    await yieldTask();
  }
  checkReadCancellation(signal);
  return bytes;
}

export async function equalSourceContent(left, right, {signal} = {}) {
  checkReadCancellation(signal);
  const length = contentLength(left);
  if (contentLength(right) !== length) return false;
  for (let start = 0; start < length; start += CHUNK_CHARACTERS) {
    checkReadCancellation(signal);
    const end = Math.min(length, start + CHUNK_CHARACTERS);
    if (contentPart(left, start, end) !== contentPart(right, start, end)) return false;
    await yieldTask();
  }
  checkReadCancellation(signal);
  return true;
}

/** Encode bounded chunks cooperatively. The consumer owns its output stream or download Blob. */
export async function* encodedWorkspaceSourceChunks(content, {path = 'Program.cs', encoding = 'utf-8', bom = false,
  signal, maxBytes = 256 * 1024 * 1024} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || contentLength(content) > maxBytes) {
    throw new RangeError('Source output byte limit exceeded');
  }
  if (!['utf-8', 'utf-16le', 'utf-16be'].includes(encoding)) throw new TypeError('Unsupported text encoding');
  let first = true;
  let total = 0;
  let offset = 0;
  for (const text of contentChunks(content)) {
    if (signal?.aborted) throw new DOMException('Source output cancelled', 'AbortError');
    validateSourceEncoding(text, {path, offset, bom});
    const bytes = encodeWorkspaceFile({path, text, encoding, bom: first && bom});
    total += bytes.byteLength;
    if (total > maxBytes) throw new RangeError('Source output byte limit exceeded');
    yield bytes;
    first = false;
    offset += text.length;
    await yieldTask();
  }
  if (signal?.aborted) throw new DOMException('Source output cancelled', 'AbortError');
}

/** Write only: the caller closes on success or aborts on rejection, including cancellation and byte-limit errors. */
export async function writeSourceContent(stream, content, options = {}) {
  for await (const bytes of encodedWorkspaceSourceChunks(content, options)) await stream.write(bytes);
}

export function updateSavedRecord(record, content, bytes) {
  if (isSourceSnapshot(content)) {
    if (!recordSource(record)) {
      Object.defineProperty(record, 'text', {configurable: true, enumerable: true,
        get() { return typeof this.source === 'string' ? this.source : this.source.getText(0, this.source.length); },
        set(text) {
          if (typeof text !== 'string') throw new TypeError('Source text must be a string');
          this.source = text;
        }});
    }
    Object.defineProperty(record, 'source', {value: content, writable: true, configurable: true});
  } else record.text = content;
  record.byteLength = bytes;
}
