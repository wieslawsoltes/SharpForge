/**
 * Name lookup rules that depend on the assembly references of a compilation (SF-A02-T22): a type that two
 * referenced assemblies both define (CS0433), a type forwarded to an assembly that is not referenced (CS1069)
 * and the extern aliases of a compilation unit or namespace (CS0430, CS1681).
 */

/**
 * The arguments of CS0433 when `types` (all types of one name and arity in a namespace) come from different
 * referenced assemblies and none is declared in source; null when the name is not in conflict.
 */
export function assemblyConflict(types) {
  if (types.length < 2) return null;
  const first = types[0],
    other = types.find(type => type !== first && type.containingAssembly !== first.containingAssembly);
  if (!other || !first.containingAssembly || !other.containingAssembly) return null;
  if (types.some(type => !type.containingAssembly)) return null;
  const identity = type => type.containingAssembly.identity.getDisplayName();
  return [identity(first), first.name, identity(other)];
}

/** The dotted text of a name made of plain identifiers (`A.B.C`), or null for any other name syntax. */
export function dottedName(syntax) {
  if (syntax.kind === 'IdentifierName') return syntax.identifier.valueText;
  if (syntax.kind !== 'QualifiedName' || syntax.right.kind !== 'IdentifierName') return null;
  const left = dottedName(syntax.left);
  return left === null ? null : left + '.' + syntax.right.identifier.valueText;
}

/**
 * Binds the `extern alias` directives of a scope.
 * @param {object[]} directives ExternAliasDirective nodes  @param resolve `name => {alias, diagnostic}`
 * @param report `(node, code, args) => void`
 * @returns {Map<string, object>} alias name -> the root namespace of the references carrying that alias
 */
export function bindExternAliases(directives, resolve, report) {
  const aliases = new Map();
  for (const directive of directives) {
    const name = directive.identifier.valueText;
    if (directive.identifier.isMissing || aliases.has(name)) continue;
    const { alias, diagnostic } = resolve(name);
    if (alias) aliases.set(name, alias.target);
    else if (diagnostic) report(directive.identifier, diagnostic.code, diagnostic.args);
  }
  return aliases;
}
