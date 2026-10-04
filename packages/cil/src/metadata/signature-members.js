import { decodeSignature, decodeTypeSignature } from './signatures.js';
import { encodeSignature, encodeTypeSignature } from './signature-writer.js';
import { parseSignatureType } from './signature-parser.js';
import { formatSignature, formatSignatureType } from './signature-format.js';
import { signatureSystemNames } from './signature-types.js';

export function cliSystemName(type) { return Object.hasOwn(signatureSystemNames, type) ? signatureSystemNames[type] : type; }

/** Compatibility writer for a type; contextual validation is provided by member writers. */
export function signatureType(writer, type, resolveToken) {
  const node = parseSignatureType(type, resolveToken);
  return writer.bytes(encodeTypeSignature(node, { context: 'return' }));
}

/** Encode a method signature; options preserve generic, vararg and explicit-this information. */
export function methodSignature(result, parameters, isStatic, resolveToken, options = {}) {
  return encodeSignature({
    kind: 'method', ...options, hasThis: !isStatic,
    returnType: parseSignatureType(result, resolveToken),
    parameters: parameters.map(type => parseSignatureType(type, resolveToken)),
  });
}

/** Encode a property directly, including indexer parameter types. */
export function propertySignature(result, parameters, isStatic, resolveToken) {
  return encodeSignature({
    kind: 'property', hasThis: !isStatic, returnType: parseSignatureType(result, resolveToken),
    parameters: parameters.map(type => parseSignatureType(type, resolveToken)),
  });
}

export function localSignature(types, resolveToken) {
  return encodeSignature({ kind: 'locals', types: types.map(type => parseSignatureType(type, resolveToken)) });
}

export function fieldSignature(type, resolveToken) {
  return encodeSignature({ kind: 'field', type: parseSignatureType(type, resolveToken) });
}

export function methodSpecSignature(types, resolveToken) {
  return encodeSignature({ kind: 'methodSpec', arguments: types.map(type => parseSignatureType(type, resolveToken)) });
}

/** Retain the historical formatted result while the AST decoder exposes binary details. */
export function readSignature(bytes, metadata) {
  return formatSignature(decodeSignature(bytes), metadata);
}

export function readTypeSignature(bytes, metadata, depth = 0) {
  const options = { initialDepth: depth, context: 'return' };
  return formatSignatureType(decodeTypeSignature(bytes, options), metadata, options);
}
