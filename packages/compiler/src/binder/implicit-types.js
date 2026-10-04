import {DiagnosticId} from '../diagnostics/codes.js';
import { TypeCompareKind } from '../symbols/types.js';
/**
 * Implicit typing (SF-A02-T52): the best common type of a set of expressions (implicitly typed arrays, the inferred
 * return type of a lambda) and the rules for the initializer of a `var` local.
 *
 * Both are pure: they take bound expressions and answer with a type or with the diagnostic Roslyn reports; the body
 * binder decides where the diagnostic goes.
 */

/** The better of two candidate types: the one the other converts to implicitly, or null when neither or both do. */
/** Two tuple types that differ only in element names merge into one that keeps the names both have (Roslyn's MergeTupleNames). */
function mergeTupleNames(first, second) {
  if (!first.isTupleType || !second.isTupleType || !first.withTupleElementNames) return null;
  if (!first.equals(second, TypeCompareKind.IgnoreTupleNames)) return null;
  const left = first.tupleElementNames ?? [],
    right = second.tupleElementNames ?? [],
    names = left.map((name, index) => (name && name === right[index] ? name : null));
  return first.withTupleElementNames(names.some(Boolean) ? names : null);
}

function betterType(first, second, converts) {
  if (first.equals(second)) return first;
  const merged = mergeTupleNames(first, second);
  if (merged) return merged;
  const firstToSecond = converts(first, second),
    secondToFirst = converts(second, first);
  if (firstToSecond === secondToFirst) return null;
  return firstToSecond ? second : first;
}

/**
 * The best common type of `types` (C# specification "Finding the best common type of a set of expressions", as
 * Roslyn's BestTypeInferrer implements it): the candidate every other candidate converts to implicitly.
 * Only types take part; whether each expression converts to the result is checked by the caller, which is why
 * `new[] { 1, null }` has the best type `int` and then fails on the `null` (CS0037) instead of having no best type.
 * @param {object[]} types candidate types, duplicates allowed, order as written
 * @param {(from:object,to:object)=>boolean} converts whether an implicit conversion between two types exists
 * @returns {object|null} the best type, or null when there is none
 */
export function bestCommonType(types, converts) {
  const candidates = [];
  for (const type of types) if (!candidates.some(candidate => candidate.equals(type))) candidates.push(type);
  let best = null,
    bestIndex = -1;
  for (let index = 0; index < candidates.length; index++) {
    const type = candidates[index];
    if (!best) {
      best = type;
      bestIndex = index;
      continue;
    }
    const better = betterType(best, type, converts);
    if (better && !better.equals(best)) bestIndex = index;
    best = better;
  }
  if (!best) return null;
  // A candidate skipped while an earlier comparison had no winner must convert to the result as well.
  for (let index = 0; index < bestIndex; index++) {
    const better = betterType(best, candidates[index], converts);
    if (!better || !better.equals(best)) return null;
  }
  return best;
}

/** What CS0815 calls an initializer that has no type. */
function untypedInitializerName(value) {
  if (value.literal === 'null') return '<null>';
  if (value.kind === 'Tuple') return '(...)';
  return '?';
}

/**
 * The diagnostic for a `var` initializer that has no type of its own, or null when the initializer is not one of
 * the forms decided here (lambdas and method groups have a natural type from C# 10 on; the caller handles those).
 * @param value the bound initializer  @returns {null|{code:string,args:string[],at:'initializer'|'declarator'}}
 */
export function untypedInitializerProblem(value) {
  if (value.form === 'collection') return { code: DiagnosticId.CS9176, args: [], at: 'initializer' };
  if (value.form === 'implicitNew') return { code: DiagnosticId.CS8754, args: ['new()'], at: 'initializer' };
  if (value.literal === 'default') return { code: DiagnosticId.CS8716, args: [], at: 'initializer' };
  return { code: DiagnosticId.CS0815, args: [untypedInitializerName(value)], at: 'declarator' };
}
