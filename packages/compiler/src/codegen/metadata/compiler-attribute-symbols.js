/** Complete compiler-owned attribute definitions, planned without mutating source namespaces or member lists. */
import { NamedTypeSymbol, Accessibility, RefKind, TypeKind } from '../../symbols/types.js';
import { NamespaceSymbol } from '../../symbols/namespaces.js';
import { FieldSymbol, MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from '../../symbols/members.js';
import { MetadataEmitError } from './type-tokens.js';
import { planMembers } from './member-plan.js';

export const CompilerAttributeBody = Object.freeze({
  Constructor: 'compilerAttributeConstructor',
  FieldConstructor: 'compilerAttributeFieldConstructor',
  FieldGetter: 'compilerAttributeFieldGetter',
  ByteArrayConstructor: 'compilerAttributeByteArrayConstructor',
});

/** Namespace identity for a synthesized type, detached from the source namespace lookup tables. */
export function compilerAttributeType(analysis, fullName) {
  const names = fullName.split('.'), name = names.pop();
  let owner = analysis.assembly.globalNamespace;
  for (const part of names) owner = new NamespaceSymbol(part, owner);
  return new NamedTypeSymbol({
    name, containingSymbol: owner, declaredAccessibility: Accessibility.Internal,
    isSealed: true, isImplicitlyDeclared: true, baseType: analysis.core.attribute,
  });
}

/** Resolve the required signature on a real symbol; a malformed declared attribute is never replaced silently. */
export function requiredAttributeConstructor(type, parameterTypes, attributeBase) {
  if (type.typeKind !== TypeKind.Class || type.isAbstract || !type.isDerivedFrom(attributeBase)) {
    throw new MetadataEmitError(`${type.toDisplayString()} must be a non-abstract class derived from System.Attribute`);
  }
  const constructor = type.getMembers('.ctor').find(method => !method.isStatic && !method.arity &&
    method.declaredAccessibility === Accessibility.Public && method.parameters.length === parameterTypes.length &&
    method.parameters.every((parameter, index) => parameter.refKind === RefKind.None && parameter.type.equals(parameterTypes[index])));
  if (!constructor) {
    const signature = parameterTypes.map(parameter => parameter.toDisplayString()).join(', ');
    throw new MetadataEmitError(`${type.toDisplayString()} requires a public instance constructor taking (${signature})`);
  }
  return constructor;
}

/** A public instance constructor whose body is supplied by the compiler-attribute CIL contribution. */
export function compilerAttributeConstructor(type, core, parameters = []) {
  const constructor = type.addMember(new MethodSymbol({
    name: '.ctor', methodKind: MethodKind.Constructor, declaredAccessibility: Accessibility.Public,
    returnType: core.void, parameters: parameters.map(parameter => new ParameterSymbol(parameter)),
  }));
  constructor.hasBody = true;
  return constructor;
}

/** A parameterless marker such as EmbeddedAttribute or IsReadOnlyAttribute. */
export function markerAttributeContract(analysis, existing, { fullName, usage = null }) {
  if (existing) return {
    type: existing, constructor: requiredAttributeConstructor(existing, [], analysis.core.attribute), plan: null, bodies: new Map(),
  };
  const type = compilerAttributeType(analysis, fullName), constructor = compilerAttributeConstructor(type, analysis.core);
  const plan = planMembers(type, analysis.core, () => null);
  const bodies = new Map([[plan.methods.find(method => method.symbol === constructor), { kind: CompilerAttributeBody.Constructor }]]);
  return { type, constructor, plan, bodies, usage };
}

/** An attribute storing its constructor argument in a readonly field, optionally exposed through a property. */
export function fieldAttributeContract(analysis, existing, options) {
  const { fullName, fieldName, fieldType, parameterName = '', propertyName = null,
    fieldAccessibility = Accessibility.Public, usage = null } = options;
  if (existing) return {
    type: existing, constructor: requiredAttributeConstructor(existing, [fieldType], analysis.core.attribute), plan: null, bodies: new Map(),
  };
  const core = analysis.core, type = compilerAttributeType(analysis, fullName);
  const field = type.addMember(new FieldSymbol({
    name: fieldName, type: fieldType, declaredAccessibility: fieldAccessibility, modifiers: DeclarationModifiers.ReadOnly,
  }));
  const constructor = compilerAttributeConstructor(type, core, [{ name: parameterName, type: fieldType }]);
  let getter = null;
  if (propertyName) {
    getter = type.addMember(new MethodSymbol({
      name: 'get_' + propertyName, methodKind: MethodKind.PropertyGet, declaredAccessibility: Accessibility.Public, returnType: fieldType,
    }));
    getter.hasBody = true;
    type.addMember(new PropertySymbol({ name: propertyName, type: fieldType, declaredAccessibility: Accessibility.Public, getMethod: getter }));
  }
  const plan = planMembers(type, core, () => null), bodies = new Map();
  for (const method of plan.methods) {
    const kind = method.symbol === constructor ? CompilerAttributeBody.FieldConstructor : CompilerAttributeBody.FieldGetter;
    bodies.set(method, { kind, field });
  }
  return { type, constructor, field, getter, plan, bodies, usage };
}
