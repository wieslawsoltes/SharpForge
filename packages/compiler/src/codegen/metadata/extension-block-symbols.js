/** Metadata declaration symbols of extension groups, separate from their original static implementation symbols. */
import { TypeParameterSymbol, TypeMap, TypeWithAnnotations, SymbolKind } from '../../symbols/types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from '../../symbols/members.js';

const copiedParameterFlags = Object.freeze([
  'variance', 'hasReferenceTypeConstraint', 'hasValueTypeConstraint', 'hasUnmanagedTypeConstraint',
  'hasConstructorConstraint', 'hasNotNullConstraint', 'allowsRefLikeType',
]);
const copiedMetadata = Object.freeze([
  'syntax', 'locations', 'boundAttributes', 'attributes', 'primaryConstraintSyntax', 'referenceTypeConstraintIsNullable',
]);

function copyMetadata(original, copy) {
  for (const key of copiedMetadata) if (original[key] !== undefined) copy[key] = original[key];
  return copy;
}

/** Generic parameter copies preserve source annotation evidence; the caller supplies their final substitution. */
export function extensionTypeParameters(originals, owner, normalized = false) {
  return originals.map((original, ordinal) => {
    const flags = Object.fromEntries(copiedParameterFlags.map(flag => [flag, original[flag]]));
    const copy = new TypeParameterSymbol({
      ...flags, name: normalized ? '$T' + ordinal : original.name, ordinal, containingSymbol: owner,
    });
    if (normalized) copy.hasNotNullConstraint = false;
    if (!normalized) copyMetadata(original, copy);
    return copy;
  });
}

/** Bind each cloned constraint once, preserving the same bare-entry keys used by nullable metadata emission. */
export function bindExtensionConstraints(originals, copies, substitution, normalized = false) {
  originals.forEach((original, index) => {
    const copy = copies[index];
    const annotations = new Map();
    copy._constraintTypes = original.constraintTypes.map(constraint => {
      const annotated = original.constraintTypesWithAnnotations?.get(constraint) ??
        (constraint instanceof TypeWithAnnotations ? constraint : new TypeWithAnnotations(constraint));
      const result = annotated.substitute(substitution);
      if (!normalized) annotations.set(result.type, result);
      return result.type;
    });
    copy.constraintTypesWithAnnotations = annotations;
    if (original.nullableConstraintTypes) {
      copy.nullableConstraintTypes = new Set([...original.nullableConstraintTypes].map(type => substitution.substituteType(type).type));
    }
  });
}

function slotModifiers(modifiers, substitution) {
  if (!modifiers) return undefined;
  return Object.fromEntries(['outer', 'inner'].map(position => [position, (modifiers[position] ?? []).map(modifier => ({
    isOptional: modifier.isOptional, type: substitution.substituteType(modifier.type).type,
  }))]));
}

/** A fresh Param symbol so emitted declaration rows never overwrite the implementation's parameter tokens. */
export function extensionParameter(original, substitution, owner) {
  const copy = new ParameterSymbol({
    name: original.name, type: original.typeWithAnnotations.substitute(substitution), containingSymbol: owner,
    refKind: original.refKind, isParams: original.isParams, isOptional: original.isOptional, scoped: original.scoped,
    ...(original.hasExplicitDefaultValue ? { explicitDefaultValue: { value: original.explicitDefaultValue } } : {}),
  });
  copyMetadata(original, copy);
  if (original.defaultValue !== undefined) copy.defaultValue = original.defaultValue;
  if (original.defaultValueSyntax !== undefined) copy.defaultValueSyntax = original.defaultValueSyntax;
  if (original.customModifiers) copy.customModifiers = slotModifiers(original.customModifiers, substitution);
  return copy;
}

/** One grouping method: block MVARs become enclosing VARs, while the method's own MVARs start at zero again. */
export function extensionMethod(original, group, blockArity, kind, methodKind = original.methodKind) {
  const isStatic = kind === 'static' || kind === 'operator';
  const method = new MethodSymbol({
    name: original.name, containingSymbol: group, methodKind, declaredAccessibility: original.declaredAccessibility,
    modifiers: isStatic ? DeclarationModifiers.Static : DeclarationModifiers.None,
    refKind: original.refKind, isVararg: original.isVararg, isInitOnly: original.isInitOnly,
  });
  const own = original.typeParameters.slice(blockArity);
  method.typeParameters = Object.freeze(extensionTypeParameters(own, method));
  const substitution = new TypeMap(original.typeParameters, [...group.typeParameters, ...method.typeParameters]);
  bindExtensionConstraints(own, method.typeParameters, substitution);
  method.returnTypeWithAnnotations = original.returnTypeWithAnnotations.substitute(substitution);
  method.parameters = Object.freeze(original.parameters.slice(isStatic ? 0 : 1).map((parameter, ordinal) => {
    const copy = extensionParameter(parameter, substitution, method);
    copy.ordinal = ordinal;
    return copy;
  }));
  method.hasBody = true;
  if (original.returnCustomModifiers) method.returnCustomModifiers = slotModifiers(original.returnCustomModifiers, substitution);
  copyMetadata(original, method);
  return method;
}

/** Clone an extension entry and its accessors; the originals remain ordinary static methods of the source class. */
export function extensionDeclaration(entry, group, blockArity) {
  const original = entry.symbol;
  if (original.kind === SymbolKind.Method) {
    const kind = entry.kind === 'operator' || entry.kind === 'instanceOperator' ? MethodKind.UserDefinedOperator : original.methodKind;
    return extensionMethod(original, group, blockArity, entry.kind, kind);
  }
  const getter = original.getMethod ? extensionMethod(original.getMethod, group, blockArity, entry.kind, MethodKind.PropertyGet) : null;
  const setter = original.setMethod ? extensionMethod(original.setMethod, group, blockArity, entry.kind, MethodKind.PropertySet) : null;
  const parameters = getter ? getter.parameters : setter.parameters.slice(0, -1);
  const property = new PropertySymbol({
    name: original.isExtensionIndexer ? 'Item' : original.name, containingSymbol: group,
    declaredAccessibility: original.declaredAccessibility, modifiers: entry.kind === 'static' ? DeclarationModifiers.Static : 0,
    type: getter ? getter.returnTypeWithAnnotations : setter.parameters.at(-1).typeWithAnnotations,
    refKind: getter?.refKind ?? original.refKind, getMethod: getter, setMethod: setter,
    parameters: parameters.map(parameter => extensionParameter(parameter, TypeMap.empty, null)),
  });
  copyMetadata(original, property);
  // Accessor Param ownership is distinct from the Property signature's parameter view.
  for (const accessor of [getter, setter]) if (accessor) accessor.containingSymbol = group;
  return property;
}
