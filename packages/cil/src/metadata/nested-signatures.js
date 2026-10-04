import {canonicalType, frameworkType} from '@sharpforge/framework';

/** Registered nested contracts retain their display names independently of CLI nesting. */
export function registeredNestedType(name) {
  const type = frameworkType(name);
  return typeof type?.declaringType === 'string' && typeof type?.nestedName === 'string' ? type : null;
}

/** Nested TypeRef names carry only their own arity; enclosing arguments belong to the TypeSpec. */
export function nestedDefinitionName(type) {
  const opening = type.declaringType.indexOf('<');
  const declaring = opening < 0 ? type.declaringType : type.declaringType.slice(0, opening);
  return declaring + '+' + type.nestedName;
}

export function canonicalNestedSignature(name) {
  return registeredNestedType(name) ? canonicalType(name) : name;
}
