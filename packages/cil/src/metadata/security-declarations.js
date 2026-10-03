import { CilError } from '../binary.js';
import { AttributeReader } from './custom-attribute-reader.js';
import { AttributeContext } from './custom-attribute-types.js';

export const securityDiagnosticCatalog = Object.freeze({
  MD0140: 'Unsupported permission-set format; expected binary dot format',
  MD0141: 'Malformed binary permission set',
  MD0142: 'Permission-set limit exceeded',
  MD0143: 'Permission-set operation cancelled',
});

function invalid(code, offset) {
  const error = new CilError(securityDiagnosticCatalog[code], offset);
  error.code = code;
  return error;
}

function bound(value, fallback, maximum) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw invalid('MD0142');
  return value;
}

/** Inspect binary DeclSecurity permission data without loading attributes or enforcing permissions. XML is unsupported. */
export function decodeBinaryPermissionSet(bytes, options = {}) {
  if (options.signal?.aborted) throw invalid('MD0143');
  if (!(bytes instanceof Uint8Array)) throw invalid('MD0141');
  const maxBytes = bound(options.maxBytes, 8 * 1024 * 1024, 16 * 1024 * 1024);
  const maxAttributes = bound(options.maxAttributes, 1000, 100000);
  if (bytes.length > maxBytes) throw invalid('MD0142');
  const context = new AttributeContext({ ...options, maxBytes,
    maxStringBytes: options.maxStringBytes ?? Math.min(64 * 1024, maxBytes) });
  const state = new AttributeReader(bytes, context), reader = state.reader;
  try {
    if (reader.u8() !== 0x2e) throw invalid('MD0140', 0);
    const count = reader.compressed();
    if (count > maxAttributes) throw invalid('MD0142', reader.position);
    if (count > reader.end - reader.position) throw invalid('MD0141', reader.position);
    const attributes = [];
    for (let index = 0; index < count; index++) {
      context.check();
      const typeName = state.string();
      if (!typeName || typeName.includes('\0')) throw invalid('MD0141', reader.position);
      const size = reader.compressed();
      // Borrow a bounded view only while parsing; outputs are the existing immutable typed argument values.
      const body = new AttributeReader(reader.take(size), context);
      const namedArguments = body.namedArguments(body.reader.compressed());
      attributes.push({ typeName, namedArguments });
    }
    if (reader.position !== reader.end) throw invalid('MD0141', reader.position);
    return { format: 'binary', attributes };
  } catch (error) {
    if (error instanceof CilError && !error.code) throw invalid('MD0141', error.offset ?? reader.position);
    throw error;
  }
}
