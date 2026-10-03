/**
 * Symbols of field-backed properties (C# 14 `field` keyword, SF-A02-T84).
 *
 * A property whose accessor bodies use `field` has the same synthesized backing field as an auto-property
 * (`<P>k__BackingField`), and each accessor without a body is auto-implemented over it. Such a property is an
 * auto-property with some hand-written accessors: `isAutoProperty` is set so that initializers, constructor
 * assignment to a getter-only property, definite assignment and code generation treat it alike, and
 * `usesFieldKeyword` tells the two apart.
 */
import { Accessibility, TypeKind } from '../types.js';
import { FieldSymbol, DeclarationModifiers } from '../members.js';
import { backingFieldName } from '../../lowering/generated-names.js';

/** True when an accessor body or the expression body of a property declaration contains the `field` keyword. */
export function usesFieldKeyword(syntax) {
  const stack = [syntax.expressionBody, ...(syntax.accessorList?.accessors ?? [])].filter(Boolean);
  while (stack.length) {
    const node = stack.pop();
    if (node.kind === 'FieldExpression') return true;
    for (const child of node.childNodes()) stack.push(child);
  }
  return false;
}

/** Class mixin for the source assembly: the backing field of a property that uses `field`. */
export const FieldKeywordSymbols = Base =>
  class extends Base {
    /** True for `{ get; set { ... } }`: a property that is neither abstract nor extern with both kinds of accessor. */
    mixesAutoAndBodiedAccessors(property, syntax) {
      const accessors = syntax.accessorList?.accessors ?? [],
        hasBody = accessor => !!(accessor.body || accessor.expressionBody);
      if (property.isAbstract || property.isExtern || !accessors.some(hasBody) || accessors.every(hasBody)) return false;
      return property.containingType?.typeKind !== TypeKind.Interface;
    }
    property(type, syntax, scope, uri) {
      const members = super.property(type, syntax, scope, uri),
        property = members[0];
      if (property && syntax.kind === 'PropertyDeclaration' && this.mixesAutoAndBodiedAccessors(property, syntax))
        // An auto-implemented accessor next to one with a body is part of the feature: CS9260 below C# 14, where
        // Roslyn reports it on the property name.
        this.host.useFeature?.(uri, syntax.identifier, 'FieldKeyword');
      if (!property || property.backingField || syntax.kind !== 'PropertyDeclaration' || !usesFieldKeyword(syntax)) return members;
      const setter = property.setMethod;
      // Unlike the field of a getter-only auto-property this one is writable: an accessor may assign `field` (lazy getters).
      const backing = new FieldSymbol({
        name: backingFieldName(property.name),
        type: property.typeWithAnnotations,
        containingSymbol: type,
        declaredAccessibility: Accessibility.Private,
        modifiers: property.modifiers & DeclarationModifiers.Static,
        associatedSymbol: property,
        isImplicitlyDeclared: true,
      });
      property.backingField = backing;
      property.isAutoProperty = true;
      property.usesFieldKeyword = true;
      for (const accessor of [property.getMethod, setter]) if (accessor && !accessor.hasBody) accessor.isAutoAccessor = true;
      return members;
    }
  };
