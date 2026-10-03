/**
 * Range variable scopes of a query expression (SF-A02-T09.5).
 *
 * A query lambda has one parameter per scope. A scope is either one range variable (`x`: the parameter is `x`) or a
 * transparent identifier: a parameter of an anonymous type whose members are the range variables in scope, possibly
 * through further transparent identifiers (`* = new { * = new { x, y }, z }`: `x` is `*.*.x`).
 */

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

