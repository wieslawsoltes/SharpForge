import {CilError} from '../binary.js';

/** Ordinary image methods keep CLI virtual/newslot/final identity across canonical PE round trips. */
export function emittedMethodFlags(method) {
  if (method.implementsDispose) return 0x1e6;
  if (method.accessor) {
    const access = {public: 6, private: 1, protected: 4, internal: 3}[method.accessor.access] ?? 1;
    return 0x880 | (method.isStatic ? 0x10 : 0) | access;
  }
  if (method.name === '.cctor') return 0x1891;
  if (method.name === '.ctor') return 0x83;
  for (const key of ['isVirtual', 'isNewSlot', 'isFinal']) {
    if (method[key] !== undefined && typeof method[key] !== 'boolean') throw new CilError('Invalid image virtual method flags');
  }
  if ((method.isNewSlot || method.isFinal) && !method.isVirtual || method.isVirtual && method.isStatic) {
    throw new CilError('Inconsistent image virtual method flags');
  }
  return (method.isStatic ? 0x96 : 0x86) | (method.isVirtual ? 0x40 : 0) |
    (method.isNewSlot ? 0x100 : 0) | (method.isFinal ? 0x20 : 0);
}

/** Decode executable flags from MethodDef bytes; optional debug metadata cannot opt a method in. */
export function loadedVirtualFlags(flags) {
  return flags & 0x40 ? {isVirtual: true, ...(flags & 0x100 ? {isNewSlot: true} : {}),
    ...(flags & 0x20 ? {isFinal: true} : {})} : {};
}
