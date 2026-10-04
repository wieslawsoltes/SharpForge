/**
 * The predefined operators on pointers (SF-A02-T47, C# spec 23.6.7-23.6.9):
 *
 *   T* + integer, integer + T*, T* - integer   a T* (integer: int, uint, long or ulong)
 *   T* - T*                                    a long: the distance in elements
 *   == != < > <= >=                            between any two pointers, or a pointer and null
 *   ++ --                                      on a T*
 *
 * Arithmetic on `void*` is CS0242: the element size is unknown.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { isPointerType, isVoidPointer, isFunctionPointerType } from '../conversions/pointer.js';

const comparisons = new Set(['==', '!=', '<', '>', '<=', '>=']);
const offsetKinds = ['int', 'uint', 'long', 'ulong'];
const result = (leftType, rightType, resultType) => ({ kind: 'builtin', family: 'pointer', leftType, rightType, resultType, isLifted: false });
const undefinedOnVoid = { kind: 'error', code: DiagnosticId.CS0242, args: [] };

/**
 * @param {(expression: object, kind: string) => object|null} offsetType the type of kind `kind` when the expression
 *   converts to it implicitly, else null
 * @returns a builtin operator result, an error result, or null when no pointer operator applies
 */
export function pointerBinaryOperator(operator, left, right, core, offsetType) {
  // Function pointers are compared like data pointers; they have no arithmetic.
  const leftFunction = isFunctionPointerType(left.type),
    rightFunction = isFunctionPointerType(right.type);
  if (leftFunction || rightFunction) {
    if (!comparisons.has(operator)) return null;
    if (leftFunction && rightFunction) return result(left.type, right.type, core.bool);
    const pointer = leftFunction ? left.type : right.type,
      other = leftFunction ? right : left;
    return other.literal === 'null' || isPointerType(other.type) ? result(pointer, pointer, core.bool) : null;
  }
  const leftPointer = isPointerType(left.type),
    rightPointer = isPointerType(right.type);
  if (!leftPointer && !rightPointer) return null;
  const offsetOf = expression => {
    for (const kind of offsetKinds) {
      const type = offsetType(expression, kind);
      if (type) return type;
    }
    return null;
  };
  if (comparisons.has(operator)) {
    if (leftPointer && rightPointer) return result(left.type, right.type, core.bool);
    const pointer = leftPointer ? left.type : right.type,
      other = leftPointer ? right : left;
    return other.literal === 'null' ? result(pointer, pointer, core.bool) : null;
  }
  if (operator === '-' && leftPointer && rightPointer) {
    if (!left.type.equals(right.type)) return null;
    return isVoidPointer(left.type) ? undefinedOnVoid : result(left.type, right.type, core.long);
  }
  if (operator !== '+' && operator !== '-') return null;
  if (leftPointer && rightPointer) return null;
  if (rightPointer && operator === '-') return null;
  const pointer = leftPointer ? left.type : right.type,
    offset = offsetOf(leftPointer ? right : left);
  if (!offset) return null;
  if (isVoidPointer(pointer)) return undefinedOnVoid;
  return leftPointer ? result(pointer, offset, pointer) : result(offset, pointer, pointer);
}

/** `++` and `--` on a pointer, or null. */
export function pointerUnaryOperator(operator, operand) {
  if (!isPointerType(operand.type) || (operator !== '++' && operator !== '--')) return null;
  if (isVoidPointer(operand.type)) return undefinedOnVoid;
  return { kind: 'builtin', family: 'pointer', leftType: operand.type, rightType: null, resultType: operand.type, isLifted: false };
}
