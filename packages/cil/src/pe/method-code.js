import { CilError } from '../binary.js';

const kinds = Object.freeze(['CIL', 'Native', 'OPTIL', 'Runtime']);

/** Classify MethodImplAttributes without inspecting the bytes at its RVA. */
export function methodCodeKind(flags) {
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff) throw new CilError('Invalid method implementation flags');
  return (flags & 7) === 4 ? 'UnmanagedIL' : kinds[flags & 3];
}

/** An RVA alone is not proof of CIL: native/OPTIL/runtime-supplied implementations are never decoded. */
export function hasCilMethodBody(rva, flags) {
  return rva !== 0 && methodCodeKind(flags) === 'CIL';
}
