import {admittedSourceValue, sourceNullableElement} from './source-nullable-profile.js';
import {
  Op
} from './opcodes.js';

/** Exact stack and type contract for source value conversions. */
export function sourceValueInstruction(image, opcode, typeIndex, declaredTypes = null) {
  if (opcode !== Op.BOX && opcode !== Op.UNBOXANY) return null;
  const name = image.constants[typeIndex];
  if (!admittedSourceValue(image, name, declaredTypes) &&
      !admittedSourceValue(image, sourceNullableElement(name), declaredTypes)) {
    throw new TypeError('Value conversion requires an admitted scalar, source struct or nullable value');
  }
  return {
    need: 1,
    delta: 0,
    result: opcode === Op.BOX ? 'object' : name
  };
}
