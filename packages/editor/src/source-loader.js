import {TextBuffer} from '@sharpforge/text';
import {EditorModel} from './model.js';

const MAXIMUM_FILE_BYTES = 256 * 1024 * 1024;
const encodings = new Map([['utf8', 'utf-8'], ['utf-8', 'utf-8'], ['utf16le', 'utf-16le'],
  ['utf-16le', 'utf-16le'], ['utf16be', 'utf-16be'], ['utf-16be', 'utf-16be']]);

/** Decode bounded chunks into a private persistent tree; the caller owns the returned model until adoption. */
export async function readEditorSource(blob, options = {}) {
  const {uri = 'Program.cs', version = 1, signal, chunkSize = 1024 * 1024,
    maxFileBytes = MAXIMUM_FILE_BYTES, maxCharacters = MAXIMUM_FILE_BYTES, onProgress, isCurrent} = options;
  validateInput(blob, {uri, version, chunkSize, maxFileBytes, maxCharacters});
  const check = () => {
    if (signal?.aborted || isCurrent && !isCurrent()) throw new DOMException('Document load cancelled', 'AbortError');
  };
  check();
  const prefix = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  check();
  const detected = sourceEncoding(prefix, options.encoding);
  const decoder = new TextDecoder(detected.encoding, {fatal: true});
  const staged = new TextBuffer('', {uri, encoding: detected.encoding, bom: detected.bom});
  try {
    for (let start = 0; start < blob.size; start += chunkSize) {
      check();
      const end = Math.min(blob.size, start + chunkSize);
      const bytes = new Uint8Array(await blob.slice(start, end).arrayBuffer());
      check();
      if (bytes.length !== end - start) throw sourceError('SFEDITOR_SOURCE_CHANGED', 'Source byte size changed during loading');
      const text = decoder.decode(bytes, {stream: end < blob.size});
      if (text.includes('\0')) throw sourceError('SFEDITOR_SOURCE_BINARY', 'Source text contains a NUL character');
      if (staged.length + text.length > maxCharacters) throw new RangeError('Decoded source character limit exceeded');
      if (text) staged.applyEdits([{start: staged.length, end: staged.length, text}], {source: 'load'});
      onProgress?.({loaded: end, total: blob.size});
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    check();
    const snapshot = staged.snapshot().withMetadata({uri, version});
    const model = new EditorModel(snapshot, {uri, version, encoding: detected.encoding, bom: detected.bom});
    model.markSaved();
    return preparedRecord(model, blob.size);
  } finally { staged.dispose(); }
}

function validateInput(blob, {uri, version, chunkSize, maxFileBytes, maxCharacters}) {
  if (!blob || typeof blob.slice !== 'function') throw new TypeError('Expected a File or Blob');
  if (!Number.isSafeInteger(blob.size) || blob.size < 0) throw new RangeError('Invalid source byte size');
  if (typeof uri !== 'string' || uri.length > 4096 || uri.includes('\0')) throw new TypeError('Invalid source URI');
  if (!Number.isSafeInteger(version) || version < 0) throw new RangeError('Invalid source version');
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 8 * 1024 * 1024) {
    throw new RangeError('Document load chunks must contain between 1 byte and 8 MiB');
  }
  for (const value of [maxFileBytes, maxCharacters]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid source loading limit');
  }
  if (blob.size > maxFileBytes) throw new RangeError('Source file byte limit exceeded');
}

/** Rebase a captured prepared source without changing or disposing the caller's original model. */
export function rebaseEditorSource(record, uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 4096 || uri.includes('\0')) throw new TypeError('Invalid source URI');
  const source = record?.source;
  if (!source || typeof source.withMetadata !== 'function' || source !== record.model?.snapshot()) {
    throw new TypeError('Rebasing requires a current prepared source snapshot');
  }
  const original = record.originalSource === source ? null
    : typeof record.originalSource?.withMetadata === 'function' ? record.originalSource.withMetadata({uri}) : record.originalSource;
  const model = new EditorModel(source.withMetadata({uri}), {
    uri, version: source.version, encoding: record.encoding, bom: record.bom
  });
  model.markSaved();
  const prepared = preparedRecord(model, record.byteLength);
  if (record.originalSource !== source) Object.defineProperty(prepared, 'originalSource', {value: original, configurable: true});
  return prepared;
}

function sourceEncoding(prefix, requested) {
  const marker = prefix[0] === 255 && prefix[1] === 254 ? 'utf-16le'
    : prefix[0] === 254 && prefix[1] === 255 ? 'utf-16be'
      : prefix[0] === 239 && prefix[1] === 187 && prefix[2] === 191 ? 'utf-8' : null;
  const encoding = requested == null ? marker ?? 'utf-8' : encodings.get(String(requested).toLowerCase());
  if (!encoding) throw sourceError('SFEDITOR_SOURCE_ENCODING', 'Unsupported source encoding');
  if (marker && marker !== encoding) throw sourceError('SFEDITOR_SOURCE_ENCODING', 'Source BOM conflicts with the requested encoding');
  return {encoding, bom: marker !== null};
}

function preparedRecord(model, byteLength) {
  const source = model.snapshot();
  const record = {path: model.uri, encoding: model.metadata.encoding, bom: model.metadata.bom, byteLength};
  Object.defineProperties(record, {
    model: {value: model, writable: true, configurable: true},
    source: {value: source, writable: true, configurable: true},
    originalSource: {value: source, configurable: true},
    length: {configurable: true, get() { return this.source.length; }},
    version: {enumerable: true, configurable: true, get() { return this.source.version; }},
    text: {enumerable: true, configurable: true,
      get() { return typeof this.source === 'string' ? this.source : this.source.text; },
      set(value) {
        if (typeof value !== 'string') throw new TypeError('Source text must be a string');
        const buffer = new TextBuffer(value, {uri: this.path, version: this.version + 1, encoding: this.encoding, bom: this.bom});
        this.source = buffer.snapshot();
        buffer.dispose();
      }}
  });
  return record;
}

function sourceError(code, message) {
  const error = new TypeError(message);
  error.code = code;
  return error;
}
