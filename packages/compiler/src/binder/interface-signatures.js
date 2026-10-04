import {TypeCompareKind, TypeMap, typeOf} from '../symbols/types.js';

/** Interface method type parameters compare by ordinal, including occurrences nested in constructed signatures. */
export function interfaceTypeMatches(left, right, leftMethod, rightMethod, substitution = null) {
  if (!left || !right) return left === right;
  if (left.equals(right, TypeCompareKind.IgnoreDynamic)) return true;
  const leftParameters = leftMethod.typeParameters ?? [];
  const rightParameters = rightMethod.typeParameters ?? [];
  if (!leftParameters.length || leftParameters.length !== rightParameters.length) return false;
  const map = substitution ?? new TypeMap(rightParameters, leftParameters);
  return left.equals(typeOf(right.substitute(map)), TypeCompareKind.IgnoreDynamic);
}

/** Shared binder signature comparison for explicit implementations and most-specific default selection. */
export function interfaceParametersMatch(left, right) {
  const leftParameters = left.parameters ?? [];
  const rightParameters = right.parameters ?? [];
  if (leftParameters.length !== rightParameters.length || (left.arity ?? 0) !== (right.arity ?? 0)) return false;
  const substitution = left.arity ? new TypeMap(right.typeParameters, left.typeParameters) : TypeMap.empty;
  return leftParameters.every((parameter, index) => parameter.refKind === rightParameters[index].refKind &&
    interfaceTypeMatches(parameter.type, rightParameters[index].type, left, right, substitution));
}
