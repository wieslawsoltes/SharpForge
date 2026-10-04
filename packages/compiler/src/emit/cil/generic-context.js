/**
 * Synthesized code in generic code (SF-A02-T30). A closure class, a cell or a state machine made for a generic
 * method needs the method's type parameters; a class cannot use them, so it declares copies of its own, and the
 * code and signatures written for the method are read with the method's parameters replaced by the copies:
 *
 *   class C<U> { void M<T>(T x) { Func<T> f = () => x; } }
 *     C<U>.<>c__DisplayClass0<T'>     `T` in the lambda body and in the field types is `T'` (VAR 1; `U` is VAR 0)
 *     in M:  newobj C<U>.<>c__DisplayClass0<T>::.ctor     the class is named over the parameters in scope at the use
 *
 * The substitution is applied where a type is encoded (codegen/metadata/type-tokens.js `within`), so bound trees and
 * symbols stay as the binder made them. A synthesized method that is generic itself (a generic local function, a
 * lambda without captures in a generic method) declares copies as method type parameters in the same way.
 */
import { TypeParameterSymbol, ConstructedNamedTypeSymbol, TypeWithAnnotations, TypeMap, SymbolKind } from '../../symbols/types.js';

const methodScope = Object.freeze({ kind: SymbolKind.Method });

function copyOf(original, ordinal, containingSymbol) {
  return new TypeParameterSymbol({
    name: original.name,
    ordinal,
    containingSymbol,
    hasReferenceTypeConstraint: original.hasReferenceTypeConstraint,
    hasValueTypeConstraint: original.hasValueTypeConstraint,
    hasUnmanagedTypeConstraint: original.hasUnmanagedTypeConstraint,
    hasConstructorConstraint: original.hasConstructorConstraint,
    // The constraints are written under the substitution of the declaring class or method, like any other type.
    constraintTypes: () => original.constraintTypes,
  });
}

/** Copies of type parameters for a class to declare (the class becomes their container when it is created). */
export function classTypeParameterCopies(originals) {
  return originals.map((original, ordinal) => copyOf(original, ordinal, null));
}

/** Copies of type parameters for a synthesized method to declare: they encode as `!!ordinal`. */
export function methodTypeParameterCopies(originals) {
  return originals.map((original, ordinal) => copyOf(original, ordinal, methodScope));
}

/**
 * The substitution that reads `originals` as `copies`, on top of `base` (the substitution of the enclosing class).
 * @returns {TypeMap|null} null when there is nothing to substitute
 */
export function substitutionOver(originals, copies, base = null) {
  if (!originals.length) return base;
  return (base ?? TypeMap.empty).with(originals, copies);
}

/** A generic type definition as it is named in its own code: constructed over its own type parameters. */
function overOwnParameters(definition) {
  const container = definition.containingType ? overOwnParameters(definition.containingType) : null;
  if (!definition.isGenericType) return definition;
  return new ConstructedNamedTypeSymbol(
    definition,
    definition.typeParameters.map(parameter => new TypeWithAnnotations(parameter)),
    container,
  );
}

/**
 * A synthesized class as code outside it names it: constructed over the type parameters it was made for (the
 * originals - the substitution of the code that names it turns them into what is in scope there).
 * @param definition the synthesized class  @param {object[]} originals the type parameters its own ones copy
 */
export function selfTypeOf(definition, originals) {
  if (!originals.length) return definition;
  const owner = definition.containingType;
  return new ConstructedNamedTypeSymbol(
    definition,
    originals.map(parameter => new TypeWithAnnotations(parameter)),
    owner ? overOwnParameters(owner) : null,
  );
}
