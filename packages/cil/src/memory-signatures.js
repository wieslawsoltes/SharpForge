import {genericTypeParts, normalizeCallType, substituteCallType} from './generic-signatures.js';

export const memoryType = type => normalizeCallType(type).replace(/^Array(?=$|\[|&)/, 'System.Array');

/** Preserve unknown modifiers and calling conventions instead of guessing a compatible overload. */
export function memorySignature(descriptor) {
  const signature = descriptor?.signature;
  if (descriptor?.kind !== 'method' || !signature || typeof descriptor.owner !== 'string' ||
      typeof signature.isStatic !== 'boolean' || !Array.isArray(signature.parameters) ||
      !signature.parameters.every(type => typeof type === 'string') || typeof signature.returnType !== 'string' ||
      signature.callingConvention || signature.explicitThis || (signature.sentinel ?? -1) !== -1) return null;
  const methodArguments = descriptor.methodArguments ?? descriptor.genericArguments ?? [];
  const arity = signature.genericArity ?? 0;
  if (!Number.isInteger(arity) || arity < 0 || !Array.isArray(methodArguments) ||
      methodArguments.length !== arity || !methodArguments.every(type => typeof type === 'string') ||
      !arity && descriptor.genericArguments !== undefined) return null;
  const owner = memoryType(descriptor.ownerInstance ?? descriptor.owner);
  const generic = genericTypeParts(owner);
  const arguments_ = methodArguments.map(memoryType);
  const canonical = type => memoryType(substituteCallType(type, generic.arguments, arguments_));
  return {owner, generic, arguments: arguments_, parameters: signature.parameters.map(canonical),
    result: canonical(signature.returnType), isStatic: signature.isStatic, arity};
}

/** Rank and bounds are part of array identity; a rank-one MD array is not a vector. */
export function arraySignatureShape(type) {
  const match = /^(.*)\[([^\[\]]*)\]$/.exec(type);
  if (!match || !match[1]) return null;
  const dimensions = match[2].split(',');
  if (dimensions.length > 32) return null;
  let boundsEnded = false, sizesEnded = false;
  for (const dimension of dimensions) {
    if (dimension === '' || dimension === '*' && dimensions.length === 1) {
      boundsEnded = true;
      sizesEnded = true;
      continue;
    }
    const bound = /^(-?\d+)\.\.\.(-?\d+)?$/.exec(dimension);
    if (!bound || boundsEnded || !Number.isSafeInteger(Number(bound[1]))) return null;
    if (bound[2] === undefined) sizesEnded = true;
    else if (sizesEnded || !Number.isSafeInteger(Number(bound[2])) || Number(bound[2]) < Number(bound[1]) - 1) return null;
  }
  return {element: match[1], rank: dimensions.length, vector: match[2] === ''};
}

export function managedMemoryElement(type) {
  return typeof type === 'string' && type !== 'void' && !/[&*]$|\bpinned\b|\bmod(req|opt)\b/.test(type);
}

/** ReadOnlySpan methods carry this required modifier on their readonly byref result. */
export function readonlyMemoryResult(type) {
  return type.replace(/& modreq\(System\.Runtime\.InteropServices\.InAttribute\)$/, '&');
}
