import {callStorageType} from '@sharpforge/cil';
import {numericTypeName, numericTypeNames} from '@sharpforge/bytecode';

const immutableScalars = new Set([...numericTypeNames, 'bool']);

/** Storage has already normalized these immutable built-in scalar values. */
export function reusableScalarType(type) {
  if (typeof type !== 'string' || /\bpinned$/.test(type)) return false;
  return immutableScalars.has(numericTypeName(callStorageType(type)));
}
