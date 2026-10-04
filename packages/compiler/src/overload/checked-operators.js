/**
 * Checked user-defined operators (C# 11): `operator checked +` is declared as `op_CheckedAddition` next to
 * `op_Addition`. In a checked context the checked form replaces the unchecked operator with the same operands.
 */
import { MethodKind } from '../symbols/members.js';

/** `op_Addition` -> `op_CheckedAddition`. */
export const checkedOperatorName = name => name.replace(/^op_/, 'op_Checked');
/** `op_CheckedAddition` -> `op_Addition`. */
export const uncheckedOperatorName = name => name.replace(/^op_Checked/, 'op_');
export const isCheckedOperatorName = name => /^op_Checked/.test(name);

/** True when two operators take the same operands (and, for conversions, produce the same type). */
export const sameOperatorSignature = (a, b) =>
  a.parameters.length === b.parameters.length &&
  a.parameters.every((parameter, index) => parameter.type?.equals(b.parameters[index].type)) &&
  (a.methodKind !== MethodKind.Conversion || !!a.returnType?.equals(b.returnType));

/**
 * The candidates of a user-defined operator in a checked context: each checked operator, and each unchecked one that
 * has no checked operator with the same operands.
 * @param {object[]} unchecked the operators named `op_X`  @param {object[]} checkedOnes the operators named `op_CheckedX`
 */
export function withCheckedOperators(unchecked, checkedOnes) {
  if (!checkedOnes.length) return unchecked;
  return [...checkedOnes, ...unchecked.filter(candidate => !checkedOnes.some(other => sameOperatorSignature(other, candidate)))];
}
