/**
 * The targets of the interpolated string conversion (C# 6, SF-A02-T60) for compilations bound against the closed
 * framework registry: `System.FormattableString` with its members, `System.IFormattable` and `System.IFormatProvider`.
 * `$"..."` converts implicitly to `FormattableString` and to `IFormattable` (conversions/classify.js); the registry
 * lists none of the three types, so the core library of a compilation gets them here, once per bridge.
 */
import { NamedTypeSymbol, TypeKind, Accessibility } from './types.js';
import { MethodSymbol, PropertySymbol, ParameterSymbol, MethodKind, DeclarationModifiers } from './members.js';

const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

function addMethod(owner, name, returnType, parameters = [], modifiers = 0) {
  if (owner.getMembers(name).some(member => member.kind === 'Method' && member.parameters.length === parameters.length)) return;
  const symbols = parameters.map(([parameterName, type]) => new ParameterSymbol({ name: parameterName, type }));
  owner.addMember(new MethodSymbol({ ...publicMember, name, returnType, parameters: symbols, modifiers }));
}

function addReadOnlyProperty(owner, name, type, modifiers = 0) {
  if (owner.getMembers(name).length) return;
  const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: type, modifiers });
  owner.addMember(getMethod);
  owner.addMember(new PropertySymbol({ ...publicMember, name, type, getMethod, modifiers }));
}

/** The interface `name` of `System`, declared when the registry's core library does not have it. */
function systemInterface(registry, name) {
  const system = registry.globalNamespace.ensureNamespace('System'),
    existing = system.getTypeMembers(name, 0)[0];
  if (existing) return existing;
  const type = new NamedTypeSymbol({ name, typeKind: TypeKind.Interface, declaredAccessibility: Accessibility.Public });
  system.addType(type);
  return type;
}

/**
 * Gives `core.formattableString` its members and resolves `core.iformattable` and `core.iformatProvider`.
 * @param core the CoreTypes being built (`bridge`, `formattableString`, `string`, `int`, `object`, `array`)
 */
export function declareFormattableTypes(core) {
  const library = core.bridge;
  if (library.assembly) {
    // A referenced core library declares the types itself.
    core.iformattable = library.assembly.getTypeByMetadataName('System.IFormattable') ?? null;
    core.iformatProvider = library.assembly.getTypeByMetadataName('System.IFormatProvider') ?? null;
    return;
  }
  const bridge = library.bridge ?? library,
    formattable = systemInterface(bridge, 'IFormattable'),
    provider = systemInterface(bridge, 'IFormatProvider'),
    target = core.formattableString,
    abstract = DeclarationModifiers.Abstract;
  Object.assign(core, { iformattable: formattable, iformatProvider: provider });
  if (bridge.formattableTypesDeclared || target.isErrorType()) return;
  bridge.formattableTypesDeclared = true;
  const formatParameters = [
    ['format', core.string],
    ['formatProvider', provider],
  ];
  addMethod(formattable, 'ToString', core.string, formatParameters, abstract);
  addMethod(provider, 'GetFormat', core.object, [['formatType', bridge.coreType('System_Type')]], abstract);
  target.isAbstract = true;
  if (!target.interfaces.length) target._interfaces = [formattable];
  addReadOnlyProperty(target, 'Format', core.string, abstract);
  addReadOnlyProperty(target, 'ArgumentCount', core.int, abstract);
  addMethod(target, 'GetArguments', core.arrayOf(core.object), [], abstract);
  addMethod(target, 'GetArgument', core.object, [['index', core.int]], abstract);
  addMethod(target, 'ToString', core.string, [['formatProvider', provider]], abstract);
  for (const name of ['Invariant', 'CurrentCulture']) addMethod(target, name, core.string, [['formattable', target]], DeclarationModifiers.Static);
}
