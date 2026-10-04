import { CilError } from '../binary.js';
import { signatureAliases, signatureBudget } from './signature-types.js';

/** Format an AST using the historical inspection strings; use the AST for binary fidelity. */
function formatter(metadata, options = {}) {
  const budget = signatureBudget(options);
  if (options.formatType !== undefined && typeof options.formatType !== 'function') {
    throw new CilError('Signature type formatter must be a function');
  }
  function name(token, depth) {
    const full = metadata?.typeName(token, depth);
    if (typeof full !== 'string') throw new CilError('Type name resolver is required');
    return Object.hasOwn(signatureAliases, full) ? signatureAliases[full] : full;
  }
  function format(type, depth = options.initialDepth ?? 0) {
    budget(depth);
    if (options.formatType) {
      const display = options.formatType(type, child => format(child, depth + 1));
      if (display !== undefined) {
        if (typeof display !== 'string') throw new CilError('Signature type formatter must return a string or undefined');
        return display;
      }
    }
    if (type.kind === 'primitive') return type.name;
    if (type.kind === 'class' || type.kind === 'valuetype') return name(type.token, depth + 1);
    if (type.kind === 'genericParameter') return (type.scope === 'method' ? '!!' : '!') + type.index;
    if (type.kind === 'genericInstance') {
      return format(type.type, depth + 1) + '<' + type.arguments.map(arg => format(arg, depth + 1)).join(', ') + '>';
    }
    if (type.kind === 'modreq' || type.kind === 'modopt') {
      return format(type.element, depth + 1) + ` ${type.kind}(${name(type.token, depth + 1)})`;
    }
    const suffix = { pointer: '*', byref: '&', szarray: '[]', pinned: ' pinned' }[type.kind];
    if (suffix) return format(type.element, depth + 1) + suffix;
    if (type.kind === 'array') {
      const dimensions = Array.from({ length: type.rank }, (_, index) => {
        const bound = type.lowerBounds[index];
        const size = type.sizes[index];
        if (size !== undefined) return `${bound ?? 0}...${(bound ?? 0) + size - 1}`;
        return bound === undefined ? '' : `${bound}...`;
      });
      const shape = type.rank === 1 && !type.sizes.length && !type.lowerBounds.length ? '*' : dimensions.join(',');
      return format(type.element, depth + 1) + '[' + shape + ']';
    }
    if (type.kind === 'functionPointer') {
      const signature = type.signature;
      return 'method ' + format(signature.returnType, depth + 1) + ' *(' +
        signature.parameters.map(parameter => format(parameter, depth + 1)).join(', ') + ')';
    }
    throw new CilError('Unknown signature type kind');
  }
  return type => format(type);
}

export function formatSignatureType(node, metadata, options = {}) {
  return formatter(metadata, options)(node);
}

/** Project the lossless AST into the original readSignature result shape. */
export function formatSignature(signature, metadata) {
  const format = formatter(metadata);
  if (signature.kind === 'field') return { kind: 'field', type: format(signature.type) };
  if (signature.kind === 'locals') return { kind: 'locals', types: signature.types.map(format) };
  if (signature.kind === 'methodSpec') return { kind: 'methodSpec', arguments: signature.arguments.map(format) };
  const result = {
    kind: signature.kind, isStatic: !signature.hasThis,
    returnType: format(signature.returnType), parameters: signature.parameters.map(format),
  };
  if (signature.genericArity) result.genericArity = signature.genericArity;
  if (signature.kind === 'property' || signature.callingConvention) result.callingConvention = signature.callingConvention ?? 8;
  if (signature.sentinel >= 0) result.sentinel = signature.sentinel;
  return result;
}
