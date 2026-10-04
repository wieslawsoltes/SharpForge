/**
 * Anonymous types (SF-A02-T53): `new { Name = value, other.Member }`.
 *
 * An anonymous type is a sealed internal class with one read-only property per member. Types are unified
 * structurally per compilation: the same member names with the same types in the same order are one type, so two
 * creation expressions of that shape are assignable to each other and `new[] { new { K = 1 }, new { K = 2 } }` has a
 * best common type; a different order is a different type.
 *
 * `Equals`, `GetHashCode` and `ToString` are the overrides of `object` on .NET. They are not declared as members
 * here: calls bind to the members of `object` and lowering selects the member-wise implementation from the static
 * type (lowering/anonymous-types.js).
 *
 * In metadata an anonymous type is what Roslyn declares: one generic class per list of member names, with a type
 * parameter per member (`<>f__AnonymousType0<<Name>j__TPar, <Age>j__TPar>`), constructed over the member types.
 * `metadataForm()` of the symbol is that construction; direct CIL emission declares the class and names its members
 * (emit/cil/anonymous-type-members.js).
 */
import { TypeKind, NamedTypeSymbol, TypeParameterSymbol, Accessibility, substituteType } from '../types.js';
import { MethodSymbol, PropertySymbol, MethodKind } from '../members.js';

const publicMember = { declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true };

/** The name diagnostics use: `<anonymous type: int A, string B>`; `<empty anonymous type>` without members. */
function displayOf(members) {
  if (!members.length) return '<empty anonymous type>';
  return `<anonymous type: ${members.map(member => `${member.type.toDisplayString()} ${member.name}`).join(', ')}>`;
}

/**
 * The generic class that declares every anonymous type with these member names, in this order.
 * @returns a type definition: `isAnonymousTemplate`, `anonymousMemberNames`; it has no member symbols
 */
function templateOf(driver, core, names) {
  const known = (driver.anonymousTemplates ??= []),
    key = names.join('\u0000'),
    existing = known.find(entry => entry.key === key);
  if (existing) return existing.symbol;
  const symbol = new NamedTypeSymbol({
    name: `<>f__AnonymousType${known.length}`,
    typeKind: TypeKind.Class,
    declaredAccessibility: Accessibility.Internal,
    baseType: () => core.object,
    isSealed: true,
    isImplicitlyDeclared: true,
    typeParameters: names.map(name => new TypeParameterSymbol({ name: `<${name}>j__TPar` })),
  });
  symbol.isAnonymousTemplate = true;
  symbol.anonymousMemberNames = names;
  known.push({ key, symbol });
  return symbol;
}

/**
 * The anonymous type with the given properties.
 * @param driver the semantic analysis (owns the per-compilation cache)  @param core the core types
 * @param {{name: string, type: object}[]} members in declaration order
 * @returns the type symbol: `isAnonymousType`, `anonymousMembers` (name and type per property)
 */
export function anonymousTypeOf(driver, core, members) {
  const known = (driver.anonymousTypes ??= []);
  const same = entry =>
    entry.members.length === members.length &&
    entry.members.every((member, index) => member.name === members[index].name && member.type.equals(members[index].type));
  const existing = known.find(same);
  if (existing) return existing.symbol;
  const symbol = new NamedTypeSymbol({
    name: `<>f__AnonymousType${known.length}`,
    typeKind: TypeKind.Class,
    // Internal in metadata; the type cannot be named, so every place that holds a value of it may use its members.
    declaredAccessibility: Accessibility.Public,
    baseType: () => core.object,
    isSealed: true,
    isImplicitlyDeclared: true,
  });
  symbol.isAnonymousType = true;
  symbol.anonymousMembers = members.map(member => ({ name: member.name, type: member.type }));
  const template = templateOf(
    driver,
    core,
    members.map(member => member.name),
  );
  let metadataForm = null;
  symbol.metadataForm = () => (metadataForm ??= template.construct(members.map(member => member.type)));
  // A member type that mentions a type parameter follows a substitution: the result is the anonymous type of the
  // substituted member types (the same symbol when nothing changes).
  symbol.substitute = map => {
    const substituted = members.map(member => ({ ...member, type: substituteType(member.type, map) }));
    return substituted.every((member, index) => member.type === members[index].type) ? symbol : anonymousTypeOf(driver, core, substituted);
  };
  const display = displayOf(members);
  symbol.toDisplayString = () => display;
  for (const { name, type } of members) {
    const getMethod = new MethodSymbol({ ...publicMember, name: 'get_' + name, methodKind: MethodKind.PropertyGet, returnType: type });
    symbol.addMember(getMethod);
    symbol.addMember(new PropertySymbol({ ...publicMember, name, type, getMethod }));
  }
  known.push({ members, symbol });
  return symbol;
}

/**
 * The property name a member declarator without `Name =` infers from its expression: a simple name, the member of
 * a member access, or the member a null-conditional access ends in (`p?.X`).
 * @param expression the expression syntax  @returns {string|null} null when no name can be inferred (CS0746)
 */
export function inferredMemberName(expression) {
  switch (expression.kind) {
    case 'IdentifierName':
      return expression.identifier.valueText;
    case 'SimpleMemberAccessExpression':
      return expression.name.kind === 'IdentifierName' ? expression.name.identifier.valueText : null;
    case 'ConditionalAccessExpression':
      return inferredMemberName(expression.whenNotNull);
    case 'MemberBindingExpression':
      return expression.name.kind === 'IdentifierName' ? expression.name.identifier.valueText : null;
    default:
      return null;
  }
}
