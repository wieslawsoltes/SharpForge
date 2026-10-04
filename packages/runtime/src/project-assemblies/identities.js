import {CilError, decodeCoded} from '@sharpforge/cil';

export function typeReferenceScope(metadata, value) {
  const seen = new Set();
  while (value >>> 24 === 1) {
    if (seen.has(value) || seen.size > 64) throw new CilError('Recursive project TypeRef scope');
    seen.add(value);
    value = decodeCoded('ResolutionScope', metadata.row(value)[0]);
  }
  return value;
}

export function scopedTypeName(module, name) {
  return '[' + module.key + ']' + name;
}

export function memberKey(name, signature) {
  return JSON.stringify([name, signature.kind, signature.type, signature.returnType, signature.parameters,
    signature.genericArity ?? 0, signature.callingConvention ?? 0, signature.isStatic ?? null]);
}
