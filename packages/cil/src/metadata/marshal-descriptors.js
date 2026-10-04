import { Reader, CilError } from '../binary.js';
import { marshalError as invalid } from './marshal-errors.js';
export { marshalDiagnosticCatalog } from './marshal-errors.js';

// UnmanagedType values describe storage; reading these never activates a marshaler or loads a type.
const nativeNames = Object.freeze({
  2: 'Bool', 3: 'I1', 4: 'U1', 5: 'I2', 6: 'U2', 7: 'I4', 8: 'U4', 9: 'I8', 10: 'U8',
  11: 'R4', 12: 'R8', 15: 'Currency', 19: 'BStr', 20: 'LPStr', 21: 'LPWStr', 22: 'LPTStr',
  23: 'ByValTStr', 25: 'IUnknown', 26: 'IDispatch', 27: 'Struct', 28: 'Interface', 29: 'SafeArray',
  30: 'ByValArray', 31: 'SysInt', 32: 'SysUInt', 34: 'VBByRefStr', 35: 'AnsiBStr', 36: 'TBStr',
  37: 'VariantBool', 38: 'FunctionPtr', 40: 'AsAny', 42: 'LPArray', 43: 'LPStruct', 44: 'CustomMarshaler',
  45: 'Error', 46: 'IInspectable', 47: 'HString', 48: 'LPUTF8Str',
});

function nativeType(type, element = false) {
  if (element && type === 0x50) return { type, name: 'Default' };
  if (!Object.hasOwn(nativeNames, type)) throw invalid('MD0131', 'Unsupported native marshal type ' + type);
  return { type, name: nativeNames[type] };
}

function limit(value, fallback) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0 || result > 16 * 1024 * 1024) throw invalid('MD0132');
  return result;
}

function integer(reader) {
  const start = reader.position;
  const value = reader.compressed();
  const size = value <= 0x7f ? 1 : value <= 0x3fff ? 2 : 4;
  if (reader.position - start !== size) throw invalid('MD0130', 'Noncanonical compressed marshal integer', start);
  return value;
}

function packedString(reader, maximum) {
  const size = integer(reader);
  if (size > maximum) throw invalid('MD0132');
  const bytes = reader.take(size);
  // These are packed strings, not text files: an initial U+FEFF is part of the value.
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw invalid('MD0130', 'Invalid UTF-8 marshal string', reader.position - size);
  }
}

function array(reader, result) {
  if (reader.position < reader.end) result.elementType = nativeType(integer(reader), true);
  if (reader.position < reader.end) result.sizeParameterIndex = integer(reader);
  if (reader.position < reader.end) result.sizeConstant = integer(reader);
  if (reader.position < reader.end) result.flags = integer(reader);
}

const tails = Object.freeze({
  ByValTStr(reader, result) { result.sizeConstant = integer(reader); },
  ByValArray(reader, result) {
    result.sizeConstant = integer(reader);
    if (reader.position < reader.end) result.elementType = nativeType(integer(reader), true);
  },
  LPArray: array,
  IUnknown: interfaceTail,
  IDispatch: interfaceTail,
  Interface: interfaceTail,
  SafeArray(reader, result, maximum) {
    if (reader.position < reader.end) result.variantType = integer(reader);
    if (reader.position < reader.end) result.userDefinedType = packedString(reader, maximum);
  },
  CustomMarshaler(reader, result, maximum) {
    result.guid = packedString(reader, maximum);
    result.nativeTypeName = packedString(reader, maximum);
    result.managedTypeName = packedString(reader, maximum);
    result.cookie = packedString(reader, maximum);
  },
});

function interfaceTail(reader, result) {
  if (reader.position < reader.end) result.iidParameterIndex = integer(reader);
}

/** Read one complete FieldMarshal blob into data, preserving optional tail fields. Throws MD0130–MD0133. */
export function decodeMarshalDescriptor(bytes, options = {}) {
  if (options.signal?.aborted) throw invalid('MD0133');
  if (!(bytes instanceof Uint8Array)) throw invalid('MD0130');
  const maxBytes = limit(options.maxBytes, 1024 * 1024);
  const maxStringBytes = limit(options.maxStringBytes, 64 * 1024);
  if (bytes.length > maxBytes) throw invalid('MD0132');
  const reader = new Reader(bytes);
  try {
    const result = nativeType(reader.u8());
    tails[result.name]?.(reader, result, maxStringBytes);
    if (reader.position !== reader.end) throw invalid('MD0130', 'Trailing native marshal data', reader.position);
    return result;
  } catch (error) {
    if (error instanceof CilError && !error.code) throw invalid('MD0130', error.message, error.offset ?? reader.position);
    throw error;
  }
}
