import { loadError, LoadErrorCode } from '../load-errors.js';

const defaults = Object.freeze({
  maxBytes: 64 * 1024 * 1024, maxEntries: 100000, maxTypes: 10000,
  maxNameBytes: 16384, maxMetadataBytes: 16 * 1024 * 1024, maxHeaderBytes: 65536,
  maxStringBytes: 16 * 1024 * 1024, maxValueBytes: 64 * 1024 * 1024,
});
const ceilings = Object.freeze({
  maxBytes: 256 * 1024 * 1024, maxEntries: 1000000, maxTypes: 100000,
  maxNameBytes: 1024 * 1024, maxMetadataBytes: 64 * 1024 * 1024, maxHeaderBytes: 1024 * 1024,
  maxStringBytes: 64 * 1024 * 1024, maxValueBytes: 256 * 1024 * 1024,
});
const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get;

export const invalidResource = message => loadError(LoadErrorCode.InvalidImage, message);
export const resourceLimit = message => loadError(LoadErrorCode.LimitExceeded, message);

export function ownedResourceBytes(input, maxBytes) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array)) throw invalidResource('Resource input must be bytes');
  if (typedArrayByteLength.call(bytes) > maxBytes) throw resourceLimit('Resource file byte limit exceeded');
  return new Uint8Array(bytes);
}

export function resourceLimits(options) {
  const result = {};
  for (const key of Object.keys(defaults)) {
    const value = options[key] ?? defaults[key];
    if (!Number.isSafeInteger(value) || value < 0 || value > ceilings[key]) {
      throw loadError(LoadErrorCode.InvalidConfiguration, `Invalid resource limit ${key}`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

/** BinaryReader's nonnegative 7-bit integer encoding, distinct from ECMA compressed integers. */
export function resourceInteger(reader) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    const byte = reader.u8();
    if (index === 4 && byte > 7) throw invalidResource('Invalid resource 7-bit integer');
    value += (byte & 0x7f) * 2 ** (index * 7);
    if (!(byte & 0x80)) return value;
  }
  throw invalidResource('Invalid resource 7-bit integer');
}

/** Per-reader decoders preserve BOM characters as data and reject invalid Unicode instead of silently replacing it. */
export class ResourceStringCodec {
  #utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  #utf16 = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true });
  string(reader, utf16, maxBytes, budget = null) {
    const length = resourceInteger(reader);
    if (length > maxBytes) throw resourceLimit('Resource string byte limit exceeded');
    if (budget && (budget.remaining -= length) < 0) throw resourceLimit('Resource metadata byte budget exceeded');
    if (utf16 && length % 2) throw invalidResource('Resource name has an odd UTF-16 byte length');
    return (utf16 ? this.#utf16 : this.#utf8).decode(reader.take(length));
  }
}

/** Stable ordinal UTF-16 hash used by .resources name tables; arithmetic intentionally wraps Int32. */
export function resourceNameHash(name) {
  let hash = 5381;
  for (let index = 0; index < name.length; index++) hash = ((hash << 5) + hash) ^ name.charCodeAt(index);
  return hash | 0;
}

export function resourceOperation(operation) {
  try { return operation(); }
  catch (error) {
    if (error.code?.startsWith('SFCLR')) throw error;
    throw invalidResource(`Invalid resource file: ${error.message}`);
  }
}
