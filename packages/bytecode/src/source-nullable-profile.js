import {Op} from './opcodes.js';
import {numericTypeId} from './numeric/numeric-types.js';

/** Source signatures retain the CLI generic identity of Nullable<T>. */
export function sourceNullableElement(type) {
  return typeof type === 'string' ? /^System\.Nullable(?:`1)?<(.+)>$/.exec(type)?.[1] ?? null : null;
}

export function admittedSourceValue(image, type, declaredTypes = null) {
  if (typeof type !== 'string') return false;
  const declared = declaredTypes ? declaredTypes.get(type)?.valueType : image.types.some(item => item.name === type && item.valueType);
  return numericTypeId(type) !== undefined || type === 'bool' || !!declared;
}

/** Closed nullable operations consume values; emitted CIL supplies the required receiver address. */
export function sourceNullableInstruction(image, opcode, typeIndex, operation, declaredTypes = null) {
  if (opcode !== Op.NULLABLE) return null;
  const owner = image.constants[typeIndex], element = sourceNullableElement(owner);
  if (!admittedSourceValue(image, element, declaredTypes) || !Number.isInteger(operation) || operation < 0 || operation > 6) {
    throw new TypeError('Nullable operation requires a closed admitted value type and valid operation');
  }
  const need = operation === 0 ? 0 : operation === 5 ? 2 : 1;
  return {need, delta: 1 - need, result: operation <= 1 ? owner : operation === 2 ? 'bool' : operation === 6 ? 'string' : element};
}
