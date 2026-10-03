import { Writer, Reader } from '../binary.js';
import { signaturePrimitives, signatureAliases } from './signature-types.js';
import { readPrimitiveValue, writePrimitiveValue } from './primitive-values.js';
import { constantError as invalid } from './constant-errors.js';
export { constantDiagnosticCatalog } from './constant-errors.js';
const invalidValue = message => invalid('MD0121', message);
const widths = Object.freeze({ 2: 1, 3: 2, 4: 1, 5: 1, 6: 2, 7: 2, 8: 4, 9: 4, 10: 8, 11: 8, 12: 4, 13: 8, 18: 4 });

function elementType(type) {
  if (typeof type === 'string') {
    const alias = Object.hasOwn(signatureAliases, type) ? signatureAliases[type] : type;
    type = Object.hasOwn(signaturePrimitives, alias) ? signaturePrimitives[alias] : undefined;
  }
  if (!Number.isInteger(type) || (!Object.hasOwn(widths, type) && type !== 14 && type !== 28)) throw invalid('MD0120');
  return type;
}

function limit(size, options) {
  if (options.signal?.aborted) throw invalid('MD0124');
  const maximum = options.maxBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 128 * 1024 * 1024 || size > maximum) {
    throw invalid('MD0123');
  }
}

/** Encode a primitive CLI Constant as {type, bytes}; null references use type 0x12 and four zero bytes. */
export function encodeConstant(type, value, options = {}) {
  type = elementType(type);
  if (value === null && (type === 14 || type === 28)) type = 18;
  if (type === 28) throw invalid('MD0121', 'Only null object constants are supported');
  if (type === 18 && value !== null) throw invalid('MD0121', 'Class constants must be null');
  if (type === 14 && typeof value !== 'string') throw invalid('MD0121', 'Expected a UTF-16 string');
  const size = type === 14 ? value.length * 2 : widths[type];
  limit(size, options);
  const writer = new Writer(size);
  if (type === 18) writer.u32(0);
  else if (type === 14) {
    // Constant strings contain raw UTF-16 code units, including embedded NUL and unmatched surrogates.
    for (let index = 0; index < value.length; index++) writer.u16(value.charCodeAt(index));
  } else writePrimitiveValue(writer, type, value, invalidValue);
  // Capacity is the exact validated width; ownership transfers without duplicating large UTF-16 blobs.
  return { type, bytes: writer.buffer };
}

/** Decode one complete Constant blob; malformed lengths, types and null encodings throw MD-coded errors. */
export function decodeConstant(type, bytes, options = {}) {
  type = elementType(type);
  if (type === 28) throw invalid('MD0120');
  if (!(bytes instanceof Uint8Array)) throw invalid('MD0122');
  limit(bytes.length, options);
  if (type === 14 ? bytes.length % 2 !== 0 : bytes.length !== widths[type]) throw invalid('MD0122');
  const reader = new Reader(bytes);
  if (type === 18) {
    if (reader.u32() !== 0) throw invalid('MD0121', 'Null constants require four zero bytes');
    return null;
  }
  if (type !== 14) return readPrimitiveValue(reader, type);
  const chunks = [];
  while (reader.position < reader.end) {
    const units = [];
    const end = Math.min(reader.end, reader.position + 8192);
    while (reader.position < end) units.push(reader.u16());
    chunks.push(String.fromCharCode(...units));
  }
  return chunks.join('');
}
