/**
 * Collection expressions whose target is built from an array of the elements (C# 12), for compilations bound
 * against reference assemblies:
 *
 *   Span<T> / ReadOnlySpan<T>          the array, converted to the span
 *   a `[CollectionBuilder]` type       `Builder.Create<T...>(ReadOnlySpan<E>)` over the array; the type may be
 *                                      declared in source or imported (`ImmutableArray<T>`, `ImmutableList<T>`)
 *
 * The array is what the array target of the same expression gives (./collection-expressions.js): an array creation,
 * or a `List<E>` filled element by element and spread by spread, then `ToArray()`. Roslyn builds spans from inline
 * arrays; the elements, their order and their evaluation are the same.
 *
 * Against the closed framework registry nothing changes: the span types there have no conversion from arrays, so
 * the collection node is kept and code generation names it.
 */
import { NamedTypeSymbol, SymbolKind } from '../symbols/types.js';
import { attributesNamed } from './bound-attributes.js';

const collectionBuilderAttribute = 'System.Runtime.CompilerServices.CollectionBuilderAttribute';
const definitionOf = type => type?.originalDefinition ?? type;
const isImported = type => definitionOf(type)?.metadataToken !== undefined;
const isReadOnlySpan = type => type instanceof NamedTypeSymbol && type.name === 'ReadOnlySpan' && type.typeArguments.length === 1;

/** The builder type and method name of a `[CollectionBuilder]` type: `{builderType, methodName}`, or null. */
function collectionBuilderOf(type) {
  const definition = definitionOf(type),
    [bound] = attributesNamed(definition, collectionBuilderAttribute);
  if (bound) {
    const [builder, name] = bound.arguments ?? [],
      builderType = builder?.operandType ?? builder?.typeOperand ?? null,
      methodName = name?.constantValue?.value;
    return builderType && typeof methodName === 'string' ? { builderType, methodName } : null;
  }
  const imported = definition.boundAttributes ? null : definition.attributes?.find(attribute => attribute.attributeClassName === collectionBuilderAttribute);
  if (!imported) return null;
  const [builderName, methodName] = imported.constructorArguments.map(argument => argument.value),
    builderType = definition.containingAssembly?.getTypeByMetadataName?.(String(builderName)) ?? null;
  return builderType && typeof methodName === 'string' ? { builderType, methodName } : null;
}

/** Class mixin over the collection expression binding. */
export const CollectionBuilderBinding = Base =>
  class extends Base {
    collectionTarget(to) {
      const target = super.collectionTarget(to);
      return target?.kind === 'collection' && isImported(to) && collectionBuilderOf(to) ? { ...target, kind: 'builder' } : target;
    }
    /**
     * The create method of a builder type, constructed for the collection type `to`: a static method with the
     * builder's name, the arity of `to`, one `ReadOnlySpan<E>` parameter and `to` as its return type.
     */
    collectionCreateMethod(to) {
      const builder = collectionBuilderOf(to),
        typeArguments = to.typeArguments?.map(argument => argument.type ?? argument) ?? [];
      for (const candidate of builder?.builderType.getMembers(builder.methodName) ?? []) {
        if (candidate.kind !== SymbolKind.Method || !candidate.isStatic || candidate.parameters.length !== 1) continue;
        if ((candidate.typeParameters?.length ?? 0) !== typeArguments.length) continue;
        const method = typeArguments.length ? candidate.construct(...typeArguments) : candidate;
        if (isReadOnlySpan(method.parameters[0].type) && method.returnType.equals(to)) return method;
      }
      return null;
    }
    materializeCollection(node, to) {
      const target = this.collectionTarget(to),
        viaArray = !!target && (target.kind === 'span' || target.kind === 'builder') && !node.withArguments,
        create = viaArray && target.kind === 'builder' ? this.collectionCreateMethod(to) : null,
        spanType = create ? create.parameters[0].type : to;
      if (!viaArray || !isImported(spanType) || (target.kind === 'builder' && !create)) return super.materializeCollection(node, to);
      const array = super.materializeCollection(node, this.core.arrayOf(target.elementType, 1));
      if (array.hasErrors) return array;
      // A spread that cannot be appended to a list keeps the collection node, as before.
      if (array.kind === 'CollectionExpression') return super.materializeCollection(node, to);
      const span = this.convert(array, spanType, node.syntax);
      if (!create || span.hasErrors) return span;
      const args = [{ expression: span, parameter: create.parameters[0], refKind: null }];
      return this.node('Call', node.syntax, to, { method: create, receiver: null, args, isCollectionExpression: true });
    }
  };
