/**
 * How the two parts of a partial method may differ (SF-A02-T54). The parts are the same method when their names,
 * arities and parameter types agree, where tuple element names, nullable annotations and `dynamic` versus `object`
 * do not count and type parameters are matched by position. What then still differs is reported on the implementing
 * part:
 *
 *   CS8142  tuple element names differ                       CS0761  constraints of a type parameter differ
 *   CS8663  `readonly` on one part only     (CS0764, `unsafe` on one part only, is binder/unsafe-declarations.js)
 *   CS8826  (warning, level 6) any other difference: parameter or type parameter names, nullable annotations,
 *           `dynamic` against `object`
 */
import {DiagnosticId} from '../../diagnostics/codes.js';
import { TypeMap, TypeCompareKind } from '../types.js';

const loose = TypeCompareKind.IgnoreTupleNames | TypeCompareKind.IgnoreNullableModifiersForReferenceTypes | TypeCompareKind.IgnoreDynamic;
const exceptTupleNames = TypeCompareKind.IgnoreNullableModifiersForReferenceTypes | TypeCompareKind.IgnoreDynamic;
const wordsOf = member => (member.syntax?.modifiers ?? []).map(token => token.text);
const annotated = typed => typed?.typeWithAnnotations ?? typed?.returnTypeWithAnnotations ?? null;

/** The implementing part's types seen with the defining part's type parameters. */
function typeParameterMap(definition, implementation) {
  const from = implementation.typeParameters ?? [],
    to = definition.typeParameters ?? [];
  return from.length === to.length && from.length ? new TypeMap(from, to) : TypeMap.empty;
}

/** `type` with the map applied (a type parameter maps to an annotated type: its type is meant). */
function substituted(type, map) {
  const result = type.substitute(map);
  return result?.type ?? result;
}

function sameTypes(definition, implementation, compare) {
  const map = typeParameterMap(definition, implementation),
    same = (a, b) => !a || !b || a.isErrorType?.() || b.isErrorType?.() || substituted(b, map).equals(a, compare);
  return (
    definition.parameters.every((parameter, index) => same(parameter.type, implementation.parameters[index].type)) &&
    same(definition.returnType, implementation.returnType)
  );
}

/** True when a defining and an implementing part declare the same method although their signature keys differ. */
export function isSamePartialMethod(definition, implementation) {
  if (definition.name !== implementation.name || definition.parameters.length !== implementation.parameters.length) return false;
  if ((definition.typeParameters?.length ?? 0) !== (implementation.typeParameters?.length ?? 0)) return false;
  if (!definition.parameters.every((parameter, index) => parameter.refKind === implementation.parameters[index].refKind)) return false;
  const map = typeParameterMap(definition, implementation);
  return definition.parameters.every((parameter, index) => substituted(implementation.parameters[index].type, map).equals(parameter.type, loose));
}

function constraintKey(parameter, map) {
  const flags = ['hasReferenceTypeConstraint', 'hasValueTypeConstraint', 'hasUnmanagedTypeConstraint', 'hasConstructorConstraint', 'hasNotNullConstraint'];
  const types = parameter.constraintTypes.map(constraint => substituted(constraint.type ?? constraint, map).toDisplayString()).sort();
  return flags.filter(flag => parameter[flag]).join(' ') + '|' + types.join(',');
}

function hasNullableDifference(definition, implementation) {
  const differs = (a, b) => !!a && !!b && a.isAnnotated !== b.isAnnotated;
  return (
    definition.parameters.some((parameter, index) => differs(annotated(parameter), annotated(implementation.parameters[index]))) ||
    differs(definition.returnTypeWithAnnotations, implementation.returnTypeWithAnnotations)
  );
}

/** The diagnostics for the differences between the two parts of one partial method. */
export function partialSignatureRows(definition, implementation) {
  const rows = [],
    row = (code, args = []) => rows.push({ member: implementation, code, args }),
    map = typeParameterMap(definition, implementation);
  (definition.typeParameters ?? []).forEach((parameter, index) => {
    const other = implementation.typeParameters[index];
    if (constraintKey(parameter, TypeMap.empty) !== constraintKey(other, map)) row(DiagnosticId.CS0761, [implementation.toDisplayString(), other.name]);
  });
  if (wordsOf(definition).includes('readonly') !== wordsOf(implementation).includes('readonly')) row(DiagnosticId.CS8663);
  // A return type that is another type altogether is CS8817 (partial-members.js); here only what a signature ignores.
  const comparable = sameTypes(definition, implementation, loose);
  if (comparable && !sameTypes(definition, implementation, exceptTupleNames)) {
    row(DiagnosticId.CS8142, [definition.toDisplayString(), implementation.toDisplayString()]);
    return rows;
  }
  const namesDiffer =
    definition.parameters.some((parameter, index) => parameter.name !== implementation.parameters[index].name) ||
    (definition.typeParameters ?? []).some((parameter, index) => parameter.name !== implementation.typeParameters[index].name);
  const typesDiffer =
    comparable && (!sameTypes(definition, implementation, TypeCompareKind.StrictNullability) || hasNullableDifference(definition, implementation));
  if (namesDiffer || typesDiffer) row(DiagnosticId.CS8826, [definition.toDisplayString(), implementation.toDisplayString()]);
  return rows;
}
