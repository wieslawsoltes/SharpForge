import {frameworkAssignable, frameworkType} from '@sharpforge/framework';

/** Registered interface upcasts preserve the same managed reference and dispatch through existing contracts. */
export function isRegisteredInterfaceReference(from, to) {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  const source = frameworkType(from);
  const target = frameworkType(to);
  return !!source && (target?.typeKind ?? target?.kind) === 'interface' && frameworkAssignable(to, from);
}
