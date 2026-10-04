import {CilError} from './binary.js';
import {formatSignature} from './metadata/signature-format.js';

function unsupported() {
  return Object.assign(new CilError('Typed instance function-pointer locals require an unmodified closed managed signature'),
    {code: 'IL_CALLI', exceptionType: 'NotSupportedException', callingConvention: 0});
}

function closedType(metadata, type) {
  if (type.kind === 'primitive') return type.name !== 'typedref';
  if (type.kind === 'class' || type.kind === 'valuetype') {
    return [1, 2].includes(type.token >>> 24) && !/[!`<>]/.test(metadata.typeName(type.token));
  }
  if (['byref', 'szarray', 'array'].includes(type.kind)) return closedType(metadata, type.element);
  return false;
}

/** Classify only a direct local fnptr; never reinterpret nested or modified storage as a local. */
export function instancePointerLocalSignature(metadata, type) {
  if (type.kind !== 'functionPointer' || !type.signature.hasThis) return null;
  const signature = type.signature;
  if (signature.explicitThis || signature.callingConvention || signature.genericArity || signature.sentinel >= 0 ||
      !closedType(metadata, signature.returnType) || !signature.parameters.every(type => closedType(metadata, type))) {
    throw unsupported();
  }
  const result = formatSignature(signature, metadata);
  Object.freeze(result.parameters);
  return Object.freeze(result);
}
