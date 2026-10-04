/**
 * Subsumption through run-time type tests (SF-A02-T08.3).
 *
 * The value spaces of flow/pattern-spaces.js do not enumerate the types a value can have, so a type test against a
 * type other than the input type is opaque to them. This module tracks the other half: the types whose non-null values
 * are all handled by the arms so far. A later arm that can only match non-null values of such a type - or of a type
 * derived from it - can never be chosen: `case object o: ... case string s:` or `{ int i => 1, 5 => 2 }`.
 *
 * Only the direction "is every value of T a value of U" is used (identity, implicit reference and boxing conversions).
 * Nothing is concluded from unrelated or sealed types, so an arm is reported only when it is certainly unreachable.
 */
import { TypeKind } from '../symbols/types.js';

const isUsable = type => !!type && !type.isErrorType?.() && type.typeKind !== TypeKind.Dynamic;
const withoutNullable = type => (type?.isNullableValueType && !type.isDefinition ? type.typeArguments[0].type : type);
/** The constant as written: the conversion to the input type (boxing, lifting) is not part of what the value is. */
function writtenConstant(value) {
  let written = value;
  while (written?.kind === 'Conversion' && written.operand) written = written.operand;
  return written;
}
function isNullConstant(pattern) {
  if (pattern.kind !== 'ConstantPattern') return false;
  const written = writtenConstant(pattern.value);
  return pattern.value?.constantValue?.isNull === true || written?.constantValue?.isNull === true || written?.literal === 'null';
}
const hasParts = pattern => !!pattern.properties?.length || !!pattern.hasPositional;

/**
 * The type every value matched by `pattern` is known to have, for a pattern that never matches null.
 * Null when the pattern may match null or the type is not known.
 */
export function narrowedType(pattern, inputType) {
  if (!pattern || pattern.hasErrors) return null;
  let type = null;
  switch (pattern.kind) {
    case 'TypePattern':
    case 'DeclarationPattern':
      type = pattern.testedType;
      break;
    case 'RecursivePattern':
      type = pattern.testedType ?? withoutNullable(inputType);
      break;
    case 'ConstantPattern':
      type = isNullConstant(pattern) ? null : writtenConstant(pattern.value)?.type;
      break;
    case 'RelationalPattern':
      type = writtenConstant(pattern.value)?.type;
      break;
    case 'NotPattern':
      type = pattern.pattern && isNullConstant(pattern.pattern) ? withoutNullable(inputType) : null;
      break;
    case 'AndPattern':
      return narrowedType(pattern.left, inputType) ?? narrowedType(pattern.right, inputType);
    default:
      return null;
  }
  return isUsable(type) ? type : null;
}

/** The types whose non-null values `pattern` matches without exception: `T`, `T x`, `T { }`, `not null`, and unions. */
export function typesCoveredBy(pattern, inputType) {
  if (!pattern || pattern.hasErrors) return [];
  switch (pattern.kind) {
    case 'TypePattern':
    case 'DeclarationPattern':
      return isUsable(pattern.testedType) ? [pattern.testedType] : [];
    case 'RecursivePattern':
    case 'NotPattern': {
      if (pattern.kind === 'RecursivePattern' && hasParts(pattern)) return [];
      const type = narrowedType(pattern, inputType);
      return type ? [type] : [];
    }
    case 'OrPattern':
      return [...typesCoveredBy(pattern.left, inputType), ...typesCoveredBy(pattern.right, inputType)];
    default:
      return [];
  }
}

const typeTestKinds = new Set(['TypePattern', 'DeclarationPattern', 'RecursivePattern']);
const constantKinds = new Set(['ConstantPattern', 'RelationalPattern']);

/**
 * True when `pattern` only matches values of a type that does not include every value of the input type: `string s`
 * on an object, `B` on its base class. However many such arms a switch expression has, they do not make it
 * exhaustive, so they can be left out of the exhaustiveness check instead of silencing it.
 */
export function isPartialTypeTest(pattern, inputType, isSubtype) {
  if (!pattern || pattern.hasErrors || !isUsable(inputType)) return false;
  if (pattern.kind === 'OrPattern') {
    return isPartialTypeTest(pattern.left, inputType, isSubtype) && isPartialTypeTest(pattern.right, inputType, isSubtype);
  }
  if (pattern.kind === 'AndPattern') return isPartialTypeTest(pattern.left, inputType, isSubtype);
  // A constant narrows the type only where the input is a reference: `5` on an object, not on a long.
  const isConstantOfReference = constantKinds.has(pattern.kind) && (inputType.isReferenceType === true || inputType.typeKind === TypeKind.TypeParameter);
  if (!(typeTestKinds.has(pattern.kind) && pattern.testedType) && !isConstantOfReference) return false;
  const type = narrowedType(pattern, inputType),
    whole = withoutNullable(inputType);
  return !!type && !type.equals?.(whole) && !isSubtype(whole, type);
}

/**
 * True when every value `pattern` can match is a non-null value of one of the `covered` types.
 * @param {(type: object, covered: object) => boolean} isSubtype whether every value of `type` is a value of `covered`
 */
export function isSubsumedByTypes(pattern, inputType, covered, isSubtype) {
  if (!covered.length || !pattern) return false;
  if (pattern.kind === 'OrPattern') {
    return isSubsumedByTypes(pattern.left, inputType, covered, isSubtype) && isSubsumedByTypes(pattern.right, inputType, covered, isSubtype);
  }
  const type = narrowedType(pattern, inputType);
  if (!type) return false;
  // Every value the switch sees is of the input type, whatever type the pattern goes on to test for.
  return covered.some(candidate => candidate === inputType || candidate.equals?.(inputType) === true || isSubtype(type, candidate));
}
