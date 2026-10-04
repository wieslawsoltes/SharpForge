/**
 * `System.IComparable`, `System.IComparable<T>` and `System.IEquatable<T>` for compilations bound against the closed
 * framework registry (SF-A02-T02).
 *
 * The registry lists none of them, so `where T : IComparable<T>` did not bind and `Max(3, 9)` could not be checked
 * against its constraint. The interfaces are declared in the bridge's core library with their one member each, and
 * the simple types and `string` implement them as they do in the BCL:
 *
 *   int : IComparable, IComparable<int>, IEquatable<int>      int.CompareTo(int), int.CompareTo(object), int.Equals(int)
 *
 * The members of the simple types carry `primitiveMember`, the name of the operation; the registry has no contract
 * for them, so code generation either expands the operation or reports the contract the registry lacks
 * (lowering/generics/translate-primitive-members.js). A referenced core library declares all of this itself.
 */
import { NamedTypeSymbol, TypeParameterSymbol, TypeKind, Accessibility, Variance } from './types.js';
import { MethodSymbol, ParameterSymbol, DeclarationModifiers } from './members.js';

/** The simple types that implement the comparison interfaces of themselves, by keyword. */
const comparableKeywords = Object.freeze([
  'bool',
  'char',
  'sbyte',
  'byte',
  'short',
  'ushort',
  'int',
  'uint',
  'long',
  'ulong',
  'float',
  'double',
  'decimal',
  'string',
]);

function method(owner, name, returnType, parameterName, parameterType, extra = {}) {
  const symbol = new MethodSymbol({
    name,
    returnType,
    parameters: [new ParameterSymbol({ name: parameterName, type: parameterType })],
    declaredAccessibility: Accessibility.Public,
    isImplicitlyDeclared: true,
    modifiers: extra.modifiers ?? 0,
  });
  if (extra.primitiveMember) symbol.primitiveMember = extra.primitiveMember;
  owner.addMember(symbol);
  return symbol;
}

/** Declares an interface of `System` with the given type parameters, or returns the one already declared. */
function declareInterface(registry, name, typeParameters) {
  const system = registry.globalNamespace.ensureNamespace('System'),
    existing = system.getTypeMembers(name, typeParameters.length)[0];
  if (existing) return { type: existing, isNew: false };
  const type = new NamedTypeSymbol({ name, typeKind: TypeKind.Interface, typeParameters, isAbstract: true });
  system.addType(type);
  return { type, isNew: true };
}

/** True when the type already declares the instance method `name(parameterType)` - with exactly that one parameter. */
function hasMethod(type, name, parameterType) {
  return type
    .getMembers(name)
    .some(member => member.kind === 'Method' && !member.isStatic && member.parameters.length === 1 && member.parameters[0].type.equals(parameterType));
}

/**
 * Declares the three interfaces once per bridge, makes the simple types and `string` implement them, and returns
 * `{ icomparable, icomparableT, iequatableT }`.
 */
export function declareComparisonInterfaces(core) {
  const library = core.bridge;
  if (library.assembly) {
    const imported = name => library.assembly.getTypeByMetadataName(name) ?? null;
    return { icomparable: imported('System.IComparable'), icomparableT: imported('System.IComparable`1'), iequatableT: imported('System.IEquatable`1') };
  }
  const registry = library.bridge ?? library,
    abstract = DeclarationModifiers.Abstract,
    icomparable = declareInterface(registry, 'IComparable', []),
    icomparableT = declareInterface(registry, 'IComparable', [new TypeParameterSymbol({ name: 'T', variance: Variance.In })]),
    iequatableT = declareInterface(registry, 'IEquatable', [new TypeParameterSymbol({ name: 'T' })]);
  if (icomparable.isNew) method(icomparable.type, 'CompareTo', core.int, 'obj', core.object, { modifiers: abstract });
  if (icomparableT.isNew) method(icomparableT.type, 'CompareTo', core.int, 'other', icomparableT.type.typeParameters[0], { modifiers: abstract });
  if (iequatableT.isNew) method(iequatableT.type, 'Equals', core.bool, 'other', iequatableT.type.typeParameters[0], { modifiers: abstract });
  for (const keyword of comparableKeywords) {
    const type = core[keyword];
    if (!type || type.isErrorType()) continue;
    const implemented = [icomparable.type, icomparableT.type.construct(type), iequatableT.type.construct(type)];
    type._interfaces = [...type.interfaces, ...implemented.filter(candidate => !type.interfaces.some(existing => existing.equals(candidate)))];
    if (!hasMethod(type, 'CompareTo', type)) method(type, 'CompareTo', core.int, 'value', type, { primitiveMember: 'CompareTo' });
    if (!hasMethod(type, 'CompareTo', core.object)) method(type, 'CompareTo', core.int, 'value', core.object, { primitiveMember: 'CompareToObject' });
    if (!hasMethod(type, 'Equals', type)) method(type, 'Equals', core.bool, 'obj', type, { primitiveMember: 'Equals' });
  }
  return { icomparable: icomparable.type, icomparableT: icomparableT.type, iequatableT: iequatableT.type };
}
