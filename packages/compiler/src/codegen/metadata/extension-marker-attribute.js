/** The shipped marker attribute, or a local definition when the selected reference surface predates .NET 10. */
import { NamedTypeSymbol, Accessibility } from '../../symbols/types.js';
import { NamespaceSymbol } from '../../symbols/namespaces.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, FieldSymbol, MethodKind, DeclarationModifiers } from '../../symbols/members.js';
import { MetadataEmitError } from './type-tokens.js';
import { planMembers } from './member-plan.js';

export const EXTENSION_MARKER_ATTRIBUTE = 'System.Runtime.CompilerServices.ExtensionMarkerAttribute';
export const ExtensionMetadataBody = Object.freeze({
  Declaration: 'extensionDeclaration',
  AttributeConstructor: 'extensionAttributeConstructor',
  AttributeName: 'extensionAttributeName',
});

/** A detached namespace chain identifies synthesized metadata without changing the compilation's source symbols. */
function compilerServicesNamespace(assembly) {
  let owner = assembly.globalNamespace;
  for (const name of ['System', 'Runtime', 'CompilerServices']) owner = new NamespaceSymbol(name, owner);
  return owner;
}

function markerConstructor(type) {
  return type.getMembers('.ctor').find(method => !method.isStatic && method.parameters.length === 1 &&
    method.parameters[0].type.specialType === 'System_String');
}

/** Resolve the actual marker contract by symbol identity; synthesize a complete attribute if it is unavailable. */
export function extensionMarkerAttribute(analysis) {
  const source = analysis.assembly.globalNamespace.lookupType(EXTENSION_MARKER_ATTRIBUTE, 0);
  const imported = analysis.references?.manager?.getTypeByMetadataName(EXTENSION_MARKER_ATTRIBUTE);
  const existing = source ?? (imported && !imported.isErrorType?.() ? imported : null);
  if (existing) {
    const constructor = markerConstructor(existing);
    if (!constructor) throw new MetadataEmitError(`${EXTENSION_MARKER_ATTRIBUTE} requires an instance constructor taking string`);
    return { type: existing, constructor, plan: null, bodies: new Map() };
  }
  const core = analysis.core;
  const type = new NamedTypeSymbol({
    name: 'ExtensionMarkerAttribute', containingSymbol: compilerServicesNamespace(analysis.assembly),
    declaredAccessibility: Accessibility.Internal, isSealed: true, isImplicitlyDeclared: true, baseType: core.attribute,
  });
  const field = type.addMember(new FieldSymbol({
    name: '_name', type: core.string, declaredAccessibility: Accessibility.Private, modifiers: DeclarationModifiers.ReadOnly,
  }));
  const constructor = type.addMember(new MethodSymbol({
    name: '.ctor', methodKind: MethodKind.Constructor, declaredAccessibility: Accessibility.Public, returnType: core.void,
    parameters: [new ParameterSymbol({ name: 'name', type: core.string })],
  }));
  const getter = type.addMember(new MethodSymbol({
    name: 'get_Name', methodKind: MethodKind.PropertyGet, declaredAccessibility: Accessibility.Public, returnType: core.string,
  }));
  constructor.hasBody = true;
  getter.hasBody = true;
  type.addMember(new PropertySymbol({ name: 'Name', type: core.string, declaredAccessibility: Accessibility.Public, getMethod: getter }));
  const plan = planMembers(type, core, () => null);
  const bodies = new Map();
  for (const method of plan.methods) {
    const kind = method.symbol === constructor ? ExtensionMetadataBody.AttributeConstructor : ExtensionMetadataBody.AttributeName;
    bodies.set(method, { kind, field });
  }
  return { type, constructor, plan, bodies };
}
