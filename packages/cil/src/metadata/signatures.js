import { Reader, CilError } from '../binary.js';
import { decodeCoded } from './indices.js';
import {
  signaturePrimitiveNames, signaturePrimitiveNodes, signatureBudget, signatureCount, checkSignatureType, checkMethodHeader,
} from './signature-types.js';

const unaryKinds = new Map([[0x0f, 'pointer'], [0x10, 'byref'], [0x1d, 'szarray'], [0x45, 'pinned']]);

function decoder(bytes, options) {
  const reader = new Reader(bytes);
  const budget = signatureBudget(options);
  const count = () => signatureCount(reader.compressed());
  const reference = () => {
    const token = decodeCoded('TypeDefOrRef', reader.compressed());
    if (!(token & 0xffffff)) throw new CilError('Null signature type token');
    return token;
  };
  function list(read, length = count()) {
    if (length > reader.end - reader.position) throw new CilError('Truncated signature list');
    return Array.from({ length }, read);
  }
  function type(depth = 0, context = 'type') {
    budget(depth);
    const code = reader.u8();
    let result;
    if (signaturePrimitiveNames[code]) result = signaturePrimitiveNodes[signaturePrimitiveNames[code]];
    else if (unaryKinds.has(code)) {
      const kind = unaryKinds.get(code);
      checkSignatureType({ kind }, context);
      const childContext = kind === 'pointer' ? 'pointer' : kind === 'pinned' ? 'pinnedLocal' : 'type';
      result = { kind, element: type(depth + 1, childContext === 'pinnedLocal' ? 'localUnpinned' : childContext) };
    } else if (code === 0x11 || code === 0x12) result = { kind: code === 0x11 ? 'valuetype' : 'class', token: reference() };
    else if (code === 0x13 || code === 0x1e) {
      result = { kind: 'genericParameter', scope: code === 0x13 ? 'type' : 'method', index: count() };
    } else if (code === 0x1f || code === 0x20) {
      result = { kind: code === 0x1f ? 'modreq' : 'modopt', token: reference(), element: type(depth + 1, context) };
    } else if (code === 0x15) {
      const base = type(depth + 1);
      if (!['class', 'valuetype'].includes(base.kind)) throw new CilError('Generic instance requires a class or valuetype');
      const length = count();
      if (!length) throw new CilError('Generic instance requires arguments');
      result = { kind: 'genericInstance', type: base, arguments: list(() => type(depth + 1), length) };
    } else if (code === 0x14) {
      const element = type(depth + 1);
      const rank = signatureCount(count(), 'Array rank', 32);
      if (!rank) throw new CilError('Array rank must be positive');
      const sizeCount = signatureCount(count(), 'Array size count', rank);
      const sizes = list(() => reader.compressed(), sizeCount);
      const boundCount = signatureCount(count(), 'Array bound count', rank);
      const lowerBounds = list(() => reader.signedCompressed(), boundCount);
      result = { kind: 'array', element, rank, sizes, lowerBounds };
    } else if (code === 0x1b) result = { kind: 'functionPointer', signature: method(depth + 1) };
    else throw new CilError(`Unsupported signature element 0x${code.toString(16)}`);
    checkSignatureType(result, context === 'localUnpinned' ? 'local' : context);
    return result;
  }
  function method(depth = 0, property = false) {
    budget(depth);
    const header = reader.u8();
    if (header & 0x80) throw new CilError('Invalid signature header');
    const callingConvention = header & 15;
    if (property && (callingConvention !== 8 || (header & 0x50))) throw new CilError('Invalid property signature');
    const genericArity = header & 0x10 ? count() : 0;
    if ((header & 0x10) && !genericArity) throw new CilError('Generic signature requires an arity');
    const length = count();
    const returnType = type(depth + 1, property ? 'property' : 'return');
    let sentinel = -1;
    let index = 0;
    const parameters = list(() => {
      if (reader.bytes[reader.position] === 0x41) {
        if (sentinel !== -1) throw new CilError('Duplicate vararg sentinel');
        reader.u8();
        sentinel = index;
      }
      index++;
      return type(depth + 1, 'parameter');
    }, length);
    const result = { kind: property ? 'property' : 'method', hasThis: !!(header & 0x20), returnType, parameters };
    if (!property) {
      Object.assign(result, { callingConvention, explicitThis: !!(header & 0x40), genericArity, sentinel });
      checkMethodHeader(result);
    } else if (sentinel !== -1) throw new CilError('Property cannot contain a sentinel');
    return result;
  }
  function signature() {
    const header = reader.bytes[reader.position];
    if (header === 6) {
      reader.u8();
      return { kind: 'field', type: type(0, 'field') };
    }
    if (header === 7 || header === 10) {
      reader.u8();
      const values = list(() => type(0, header === 7 ? 'local' : 'type'));
      if (header === 10 && !values.length) throw new CilError('MethodSpec requires arguments');
      return header === 7 ? { kind: 'locals', types: values } : { kind: 'methodSpec', arguments: values };
    }
    return method(0, (header & 15) === 8);
  }
  return { reader, type, signature };
}

/** Decode a lossless signature AST. Input is bounded; malformed signatures throw CilError. */
export function decodeSignature(bytes, options = {}) {
  const state = decoder(bytes, options);
  const result = state.signature();
  if (state.reader.position !== state.reader.end) throw new CilError('Trailing signature bytes');
  return result;
}

/** Decode a TypeSpec AST, preserving class/value semantics, modifiers and array bounds. */
export function decodeTypeSignature(bytes, options = {}) {
  const state = decoder(bytes, options);
  const result = state.type(options.initialDepth ?? 0, options.context ?? 'type');
  if (state.reader.position !== state.reader.end) throw new CilError('Trailing type signature bytes');
  return result;
}
