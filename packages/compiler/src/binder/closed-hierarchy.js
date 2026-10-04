/**
 * The set of subtypes of a closed class (SF-A02-T90). PROVISIONAL: C# 15 preview, after
 * csharplang/proposals/csharp-15.0/closed-hierarchies.md revision 1 (packages/syntax/src/preview-revisions.js); the
 * pinned Roslyn does not implement the feature.
 *
 * "Determining subtypes of a closed class": for a closed type `C` with original definition `C0`, every subtype
 * declaration `S0` whose base type has original definition `C0` contributes the construction `S` whose base type is
 * `C`, when one exists. "Exhaustiveness when a subtype can't be used": a subtype that is not valid at the use site
 * (accessibility, constraints, a generic subtype whose applicability depends on a type argument that is still open)
 * means the switch cannot be exhausted through the subtypes. "Exhaustiveness when no subtypes exist": the same holds
 * for a closed class without subtypes. In those cases the hierarchy is `isOpen`: only a pattern for the closed class
 * itself handles the rest.
 *
 * Not decided by the proposal and therefore not done here: looking through a subtype that is itself closed (the rule
 * speaks of the direct descendants only), and subtypes nested in generic types (the hierarchy is then `isOpen`).
 */
import { ArrayTypeSymbol, NamedTypeSymbol, TypeParameterSymbol, TypeKind } from '../symbols/types.js';
import { constructType, containsTypeParameter, effectiveBaseClass } from '../symbols/substitution.js';
import { isAccessible } from './accessibility.js';
import { checkConstraints } from './constraints.js';
import { isImportedClosedClass } from './closed-metadata.js';

const bare = argument => argument?.type ?? argument;

/**
 * Matches the base class specification of a subtype declaration (written over the subtype's own type parameters)
 * against the closed type of the switch. Returns 'yes' (with `bindings` filled), 'no', or 'maybe' when the answer
 * depends on what a type parameter of the use site is replaced with.
 */
function unify(pattern, target, bindings) {
  if (pattern instanceof TypeParameterSymbol && bindings.has(pattern)) {
    const bound = bindings.get(pattern);
    if (bound === null) {
      bindings.set(pattern, target);
      return 'yes';
    }
    if (bound.equals(target)) return 'yes';
    return containsTypeParameter(bound) || containsTypeParameter(target) ? 'maybe' : 'no';
  }
  if (pattern.equals(target)) return 'yes';
  const open = target instanceof TypeParameterSymbol ? 'maybe' : 'no';
  if (pattern instanceof ArrayTypeSymbol) {
    if (!(target instanceof ArrayTypeSymbol) || target.rank !== pattern.rank) return open;
    return unify(pattern.elementType, target.elementType, bindings);
  }
  if (pattern instanceof NamedTypeSymbol && pattern.typeArguments?.length) {
    const sameDefinition = target instanceof NamedTypeSymbol && target.originalDefinition === pattern.originalDefinition;
    if (!sameDefinition || target.typeArguments.length !== pattern.typeArguments.length) return open;
    let result = 'yes';
    for (const [index, argument] of pattern.typeArguments.entries()) {
      const part = unify(bare(argument), bare(target.typeArguments[index]), bindings);
      if (part === 'no') return 'no';
      if (part === 'maybe') result = 'maybe';
    }
    return result;
  }
  return open;
}

/** The construction of the subtype declaration `declaration` whose base type is `closedType`: `{type}`, `{isUnusable}` or null. */
function constructionOf(declaration, closedType, context) {
  const parameters = [...(declaration.typeParameters ?? [])];
  // A subtype nested in a generic type has type parameters this module does not solve for.
  for (let outer = declaration.containingType; outer; outer = outer.containingType) if (outer.arity) return { isUnusable: true };
  const bindings = new Map(parameters.map(parameter => [parameter, null])),
    match = unify(declaration.baseType, closedType, bindings);
  if (match === 'no') return null;
  const typeArguments = parameters.map(parameter => bindings.get(parameter));
  if (match === 'maybe' || typeArguments.includes(null)) return { isUnusable: true };
  const type = parameters.length ? constructType(declaration, typeArguments) : declaration;
  if (parameters.length && checkConstraints(parameters, typeArguments, { core: context.core, display: type.toDisplayString() }).some(row => !row.severity))
    return { isUnusable: true };
  if (!isAccessible(declaration, context.within, { withinModule: context.withinModule })) return { isUnusable: true };
  return { type };
}

/**
 * The closed hierarchy a switch over `type` is checked against, or null when `type` is not a closed class (or a type
 * parameter constrained to one: "Exhaustiveness of type parameters constrained to closed type").
 * @param type the type of the governing expression
 * @param {{core: object, within: object|null, withinModule: object|null}} context the use site
 * @returns {{closedType: object, subtypes: object[], isOpen: boolean}|null}
 */
export function closedHierarchyOf(type, context) {
  const closedType = type instanceof TypeParameterSymbol ? effectiveBaseClass(type, context.core) : type,
    definition = closedType?.originalDefinition;
  // A closed class of a referenced assembly is recognised by its attribute, with the subtypes of its own assembly.
  isImportedClosedClass(definition);
  if (!definition?.isClosedClass || closedType.typeKind !== TypeKind.Class) return null;
  const subtypes = [];
  let isOpen = false;
  for (const declaration of definition.closedSubtypes ?? []) {
    const construction = constructionOf(declaration, closedType, context);
    if (construction?.isUnusable) isOpen = true;
    else if (construction) subtypes.push(construction.type);
  }
  return { closedType, subtypes, isOpen: isOpen || subtypes.length === 0 };
}
