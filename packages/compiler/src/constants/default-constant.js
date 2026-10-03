/**
 * The constant a default value expression denotes (`default(T)`, the `default` literal converted to T).
 *
 * A default value is a constant when T is a simple type, an enum or a reference type (C# spec 12.23); for every
 * other type - a struct, a nullable value type, a type parameter - it is a value computed at run time.
 */
import { TypeKind } from '../symbols/types.js';
import { numericKind } from '../conversions/numeric.js';
import { isNullableType } from '../conversions/nullable.js';
import { defaultValue } from './fold.js';

const simpleKeywords = { System_Boolean: 'bool', System_String: 'string', System_Char: 'char', System_Object: 'object' };

/** @returns {ConstantValue|null} the default of `type` as a constant, or null when it is not one */
export function defaultConstant(type) {
  if (!type || type.isErrorType?.() || isNullableType(type)) return null;
  const keyword = numericKind(type) ?? simpleKeywords[type.specialType] ?? null;
  if (!keyword && type.typeKind !== TypeKind.Enum && type.isReferenceType !== true) return null;
  try {
    return defaultValue(type.typeKind === TypeKind.Enum ? type : (keyword ?? 'object'));
  } catch {
    return null;
  }
}
