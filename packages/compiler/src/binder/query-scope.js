/**
 * Range variable scopes of a query expression (SF-A02-T09.5).
 *
 * A query lambda has one parameter per scope. A scope is either one range variable (`x`: the parameter is `x`) or a
 * transparent identifier: a parameter of an anonymous type whose members are the range variables in scope, possibly
 * through further transparent identifiers (`* = new { * = new { x, y }, z }`: `x` is `*.*.x`).
 */
import { TypeKind, NamedTypeSymbol, Accessibility } from '../symbols/types.js';
import { MethodSymbol, PropertySymbol, MethodKind } from '../symbols/members.js';

/** Roslyn's name of the n-th transparent identifier of a query. */
export const transparentIdentifierName = ordinal => `<>h__TransparentIdentifier${ordinal}`;

/** The scope of one range variable. */
export function rangeScope(name) {
  return { parameter: name, paths: new Map([[name, []]]) };
}

/**
 * The scope after `outer` and the range variable `name` were paired into a transparent identifier.
 * @param outer the scope so far  @param {string} name the new range variable  @param {number} ordinal of the identifier
 */
export function transparentScope(outer, name, ordinal) {
  // The new parameter has a member named after the old one: a lone variable `x` is `*.x`, a variable behind the
  // transparent identifier `t` is `*.t.<its path>`.
  const paths = new Map();
  for (const [variable, path] of outer.paths) paths.set(variable, [outer.parameter, ...path]);
  paths.set(name, [name]);
  return { parameter: transparentIdentifierName(ordinal), paths };
}

/** `name -> {parameter, path}` for every range variable that is reached through a member of a lambda parameter. */
export function memberPaths(scopes) {
  const reached = new Map();
  for (const scope of scopes) for (const [name, path] of scope.paths) if (path.length) reached.set(name, { parameter: scope.parameter, path });
  return reached;
}

/**
 * The anonymous type with the given properties, unified structurally per compilation: the same names and types in
 * the same order are the same type, as in Roslyn, so a lambda bound once for inference and once for its final
 * delegate type yields one type.
 * @param driver the semantic analysis (owns the cache)  @param core the core types
 * @param {{name: string, type: object}[]} members
 */
export function anonymousTypeOf(driver, core, members) {
  const known = (driver.anonymousTypes ??= []);
  const same = type =>
    type.members.length === members.length && type.members.every((m, i) => m.name === members[i].name && m.type.equals(members[i].type));
  const existing = known.find(same);
  if (existing) return existing.symbol;
  const symbol = new NamedTypeSymbol({
    name: `<>f__AnonymousType${known.length}`,
    typeKind: TypeKind.Class,
    declaredAccessibility: Accessibility.Internal,
    baseType: () => core.object,
    isSealed: true,
    isImplicitlyDeclared: true,
  });
  symbol.isAnonymousType = true;
  const display = `<anonymous type: ${members.map(m => `${m.type.toDisplayString()} ${m.name}`).join(', ')}>`;
  symbol.toDisplayString = () => display;
  for (const { name, type } of members) {
    const get = new MethodSymbol({
      name: 'get_' + name,
      methodKind: MethodKind.PropertyGet,
      returnType: type,
      declaredAccessibility: Accessibility.Public,
      isImplicitlyDeclared: true,
    });
    symbol.addMember(get);
    symbol.addMember(new PropertySymbol({ name, type, getMethod: get, declaredAccessibility: Accessibility.Public, isImplicitlyDeclared: true }));
  }
  known.push({ members, symbol });
  return symbol;
}
