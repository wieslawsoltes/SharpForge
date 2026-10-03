import { CilError } from '../binary.js';

/** ECMA-335 II.23.1.16 primitive element codes; names preserve the inspection API. */
export const signaturePrimitives = Object.freeze({
  void: 1, bool: 2, char: 3, sbyte: 4, byte: 5, short: 6, ushort: 7,
  int: 8, uint: 9, long: 10, ulong: 11, float: 12, double: 13, string: 14,
  typedref: 22, nint: 24, nuint: 25, object: 28,
});
export const signaturePrimitiveNames = Object.freeze(Object.fromEntries(
  Object.entries(signaturePrimitives).map(([name, code]) => [code, name]),
));
export const signaturePrimitiveNodes = Object.freeze(Object.fromEntries(
  Object.keys(signaturePrimitives).map(name => [name, Object.freeze({ kind: 'primitive', name })]),
));
export const signatureSystemNames = Object.freeze({
  void: 'System.Void', bool: 'System.Boolean', char: 'System.Char', sbyte: 'System.SByte', byte: 'System.Byte',
  short: 'System.Int16', ushort: 'System.UInt16', int: 'System.Int32', uint: 'System.UInt32',
  long: 'System.Int64', ulong: 'System.UInt64', float: 'System.Single', double: 'System.Double',
  string: 'System.String', object: 'System.Object', typedref: 'System.TypedReference',
  nint: 'System.IntPtr', nuint: 'System.UIntPtr', Exception: 'System.Exception', Array: 'System.Array',
});
export const signatureAliases = Object.freeze(Object.fromEntries(
  Object.entries(signatureSystemNames).map(([name, full]) => [full, name]),
));

export function signatureCount(value, label = 'Signature count', maximum = 65535) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new CilError(`${label} limit exceeded`);
  return value;
}

export function signatureBudget(options = {}) {
  const maxDepth = signatureCount(options.maxDepth ?? 64, 'Signature depth', 256);
  let remaining = signatureCount(options.maxNodes ?? 4096, 'Signature nodes', 1_000_000);
  return depth => {
    if (depth > maxDepth || --remaining < 0) throw new CilError('Signature complexity limit exceeded');
    if (options.signal?.aborted) throw new CilError('Signature operation cancelled');
  };
}

/** Reject context-invalid type forms before emitting or accepting a signature. */
export function checkSignatureType(type, context) {
  if (!type || typeof type !== 'object') throw new CilError('Invalid signature type');
  if (type.kind === 'primitive') {
    if (!Object.hasOwn(signaturePrimitives, type.name)) throw new CilError('Unknown signature primitive');
    if (type.name === 'void' && !['return', 'pointer'].includes(context)) throw new CilError('Void is invalid in this signature');
    if (type.name === 'typedref' && !['return', 'property', 'parameter', 'local', 'localUnpinned'].includes(context)) {
      throw new CilError('TypedReference is invalid in this signature');
    }
  }
  if (type.kind === 'byref' && !['return', 'property', 'parameter', 'local', 'localUnpinned'].includes(context)) {
    throw new CilError('Byref is invalid in this signature');
  }
  if (type.kind === 'pinned' && context !== 'local') throw new CilError('Pinned is only valid for locals');
}

export function checkMethodHeader(signature) {
  const convention = signature.callingConvention ?? 0;
  if (![0, 1, 2, 3, 4, 5, 9, 11].includes(convention)) throw new CilError('Invalid method calling convention');
  if (signature.explicitThis && !signature.hasThis) throw new CilError('Explicit-this requires has-this');
  const arity = signatureCount(signature.genericArity ?? 0, 'Generic arity');
  if (arity && ![0, 5].includes(convention)) throw new CilError('Invalid generic method calling convention');
  const sentinel = signature.sentinel ?? -1;
  if (!Number.isInteger(sentinel) || sentinel < -1 || sentinel >= signature.parameters.length ||
      (sentinel >= 0 && convention !== 5 && convention !== 11)) throw new CilError('Invalid vararg sentinel');
  return convention | (arity ? 0x10 : 0) | (signature.hasThis ? 0x20 : 0) | (signature.explicitThis ? 0x40 : 0);
}
