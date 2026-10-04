import {CilError} from '../binary.js';
import {sourceMethodFlags} from '../source-object-slots.js';

/** Ordinary image methods keep CLI virtual/newslot/final identity across canonical PE round trips. */
export function emittedMethodFlags(method) {
  for (const key of ['isVirtual', 'isNewSlot', 'isFinal']) {
    if (method[key] !== undefined && typeof method[key] !== 'boolean') throw new CilError('Invalid image virtual method flags');
  }
  if ((method.isNewSlot || method.isFinal) && !method.isVirtual || method.isVirtual && method.isStatic) {
    throw new CilError('Inconsistent image virtual method flags');
  }
  return sourceMethodFlags(method);
}

/** Decode executable flags from MethodDef bytes; optional debug metadata cannot opt a method in. */
export function loadedVirtualFlags(flags) {
  return flags & 0x40 ? {isVirtual: true, ...(flags & 0x100 ? {isNewSlot: true} : {}),
    ...(flags & 0x20 ? {isFinal: true} : {})} : {};
}
