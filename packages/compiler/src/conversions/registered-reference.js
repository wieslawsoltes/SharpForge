import {frameworkAssignable, frameworkType} from '@sharpforge/framework';
import {registryTypeKind} from '../symbols/registry-type-shapes.js';
import {TypeKind} from '../symbols/types.js';

function isReferenceClass(type) {
  return type.kind !== 'static' && registryTypeKind(type) === TypeKind.Class;
}

/** Registry-proven class and interface upcasts preserve the existing managed reference. */
export function isRegisteredReferenceUpcast(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  const source = frameworkType(from);
  const target = frameworkType(to);
  if (!source || !target) return false;
  const reference = (target.typeKind ?? target.kind) === 'interface' || isReferenceClass(source) && isReferenceClass(target);
  return reference && frameworkAssignable(to, from);
}
