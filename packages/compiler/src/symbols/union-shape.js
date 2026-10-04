/**
 * Union API shapes, pinned to csharplang 412dc3023500b69f684c365762e38db6ee7564ea,
 * proposals/csharp-15.0/unions.md revision 1. Shapes belong to symbols, never to global caches.
 * Type parameters are deliberately excluded, including parameters constrained to a union type.
 */
import { Accessibility, RefKind, SymbolKind, TypeKind } from './types.js';
import { MethodKind } from './members.js';
import { allInterfacesOf, membersInHierarchy } from './substitution.js';
import { stripNullable } from '../conversions/nullable.js';
import { attributesNamed, fullNameOf } from '../binder/bound-attributes.js';

export const UNION_ATTRIBUTE = 'System.Runtime.CompilerServices.UnionAttribute';
export const UNION_INTERFACE = 'System.Runtime.CompilerServices.IUnion';

/** The exact framework contract from source or references, without creating a replacement. */
export function unionContract(namespace, name) {
  return namespace.lookupNamespace('System.Runtime.CompilerServices')?.getTypeMembers(name, 0)[0] ?? null;
}

/** True for an attributed class/struct or a compiler-generated union declaration. */
export function isUnionType(type) {
  const definition = stripNullable(type)?.originalDefinition;
  if (!definition || definition.typeKind !== TypeKind.Struct && definition.typeKind !== TypeKind.Class) return false;
  if (definition.isUnionDeclaration) return true;
  return (definition.boundAttributes ?? []).some(attribute => fullNameOf(attribute.attributeClass) === UNION_ATTRIBUTE) ||
    (definition.attributes ?? []).some(attribute => !attribute.hasErrors && attribute.attributeClassName === UNION_ATTRIBUTE);
}

const isPublic = member => member.declaredAccessibility === Accessibility.Public;
const byValueOrIn = parameter => parameter.refKind === RefKind.None || parameter.refKind === RefKind.In;
const methodsNamed = (type, name, core) => membersInHierarchy(type, name, core).filter(member => member.kind === SymbolKind.Method);

const hasRequiredModifier = modifiers => modifiers?.some(modifier => !modifier.isOptional);
const hasRequiredSignatureModifier = modifiers => hasRequiredModifier(modifiers?.outer) || hasRequiredModifier(modifiers?.inner);
const experimentalAttribute = 'System.Diagnostics.CodeAnalysis.ExperimentalAttribute';

function isBadOptimizationMember(member) {
  const definition = member.originalDefinition ?? member;
  return definition.obsolete || definition.experimentalId || definition.unsupportedCompilerFeature || definition.hasErrors ||
    attributesNamed(definition, experimentalAttribute).length ||
    definition.attributes?.some(attribute => attribute.attributeClassName === experimentalAttribute) ||
    hasRequiredModifier(member.typeWithAnnotations?.customModifiers) ||
    hasRequiredSignatureModifier(definition.returnCustomModifiers) ||
    member.parameters?.some(parameter => hasRequiredModifier(parameter.typeWithAnnotations.customModifiers) ||
      hasRequiredSignatureModifier((parameter.originalDefinition ?? parameter).customModifiers)) ||
    member.getMethod && isBadOptimizationMember(member.getMethod);
}

function accessMembers(shape, core) {
  const matchesHasValue = member => member.kind === SymbolKind.Property && !member.isStatic && !member.parameters.length &&
    member.type.specialType === 'System_Boolean' && member.refKind === RefKind.None && member.getMethod;
  const matchesTryGet = member => member.kind === SymbolKind.Method && !member.isStatic &&
    !member.arity && member.refKind === RefKind.None && member.returnType.specialType === 'System_Boolean' && member.parameters.length === 1 &&
    member.parameters[0].refKind === RefKind.Out && shape.caseTypes.some(type => type.equals(member.parameters[0].type));
  const members = membersInHierarchy(shape.definingType, 'HasValue', core)
    .concat(methodsNamed(shape.definingType, 'TryGetValue', core))
    .filter(member => !isBadOptimizationMember(member) && (matchesHasValue(member) || matchesTryGet(member)));
  if (members.some(member => !isPublic(member) || member.getMethod && !isPublic(member.getMethod)))
    shape.problems.push('accessAccessibility');
  // The mandatory direct, getter-only forms are specified. The precise inherited/hidden/read-write lookup
  // remains an open question in revision 1; do not choose a behavior for those cases.
  shape.hasUnresolvedAccessPattern = members.some(member => !member.containingType.equals(shape.definingType) ||
    member.kind === SymbolKind.Property && member.setMethod);
  shape.hasValue = members.find(member => matchesHasValue(member) && member.containingType.equals(shape.definingType)) ?? null;
  shape.tryGetValues = members.filter(member => matchesTryGet(member) && member.containingType.equals(shape.definingType));
}

function basicMembers(type, provider, core) {
  const definingType = provider ?? type;
  const candidates = provider ? methodsNamed(provider, 'Create', core) : type.getMembers('.ctor');
  const creationMembers = candidates.filter(member => member.kind === SymbolKind.Method && member.parameters.length === 1 &&
    (provider ? member.isStatic && member.returnType.equals(type) : member.methodKind === MethodKind.Constructor));
  const properties = membersInHierarchy(definingType, 'Value', core).filter(member =>
    member.kind === SymbolKind.Property && !member.isStatic && !member.parameters.length);
  const valueProperty = properties.find(property => property.type.specialType === 'System_Object' && property.getMethod) ?? null;
  const problems = [];
  if (!creationMembers.length || !valueProperty) problems.push('basicPattern');
  for (const member of creationMembers) {
    if (!isPublic(member)) problems.push('creationAccessibility');
    if (!byValueOrIn(member.parameters[0])) problems.push('creationRefKind');
  }
  if (valueProperty && (!isPublic(valueProperty) || !isPublic(valueProperty.getMethod))) problems.push('valueAccessibility');
  return { definingType, candidates, creationMembers, valueProperty, problems };
}

/**
 * The usable basic pattern and its case types, or null for a non-union. Missing custom APIs remain a distinct
 * unresolved proposal question; callers report it explicitly instead of silently treating the type as ordinary.
 */
export function unionShapeOf(inputType, core) {
  const type = stripNullable(inputType);
  if (!isUnionType(type)) return null;
  if (type.unionShape) return type.unionShape;
  const providers = type.getTypeMembers('IUnionMembers', 0).filter(member => member.typeKind === TypeKind.Interface);
  const provider = providers[0] ?? null;
  const shape = basicMembers(type, provider, core);
  if (provider && (!isPublic(provider) || !allInterfacesOf(type, core).some(iface => iface.equals(provider))))
    shape.problems.push('provider');
  const caseTypes = [];
  for (const member of shape.creationMembers) {
    // The resolved question "Nullable value types as Union case types" makes the underlying type the case.
    const caseType = stripNullable(member.parameters[0].type);
    if (!caseTypes.some(other => other.equals(caseType))) caseTypes.push(caseType);
  }
  shape.type = type;
  shape.provider = provider;
  shape.caseTypes = caseTypes;
  accessMembers(shape, core);
  shape.valid = shape.problems.length === 0;
  type.unionShape = shape;
  return shape;
}
