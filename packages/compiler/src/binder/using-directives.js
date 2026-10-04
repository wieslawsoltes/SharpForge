/**
 * Binding the using directives and extern aliases of a compilation unit or namespace declaration (SF-A02-T24).
 *
 * `bindUsingDirectives` resolves each directive in the scope that contains it and reports, on the span Roslyn uses:
 * CS0246 / CS0234 (the namespace or type does not exist), CS0138 (`using` of a type), CS7007 (`using static` of a
 * namespace), CS0105 (duplicate directive, a warning), CS1537 (duplicate alias) and the extern alias errors.
 * Alias targets are bound separately (`bindAliasTarget`), because an alias may not see its sibling directives and
 * may be referenced before the scope's directives are complete.
 *
 * A namespace of the base class library that the framework registry does not model is not an error: the host's
 * `tolerateNamespace` decides from the explicit BCL namespace list (symbols/bcl-namespaces.js).
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { bindExternAliases } from './reference-lookup.js';
import { implicitUsingsUri } from './global-usings.js';
import { checkUsingDirectiveSyntax, checkAliasTargetType } from './using-alias-rules.js';

const nameKinds = new Set(['IdentifierName', 'QualifiedName', 'AliasQualifiedName', 'GenericName']);
const textOf = syntax => syntax.toString().replace(/\s+/g, '');

/**
 * @param binder the TypeBinder  @param scope a unit or namespace Scope with `usings: {directives, global, externs, bound}`
 * @param {Function} createOuterScope returns the scope the directives are bound in (the same level without its usings)
 * @returns {{aliases:Map,namespaces:object[],staticTypes:object[],externAliases:Map}|null}
 */
export function bindUsingDirectives(binder, scope, createOuterScope) {
  const usings = scope.usings;
  if (!usings) return null;
  if (usings.bound) return usings.bound;
  const bound = (usings.bound = { aliases: new Map(), namespaces: [], staticTypes: [], externAliases: new Map() });
  const host = binder.host;
  if (usings.externs?.length) {
    const resolve = name => host.externAlias?.(name) ?? { alias: null, diagnostic: null };
    bound.externAliases = bindExternAliases(usings.externs, resolve, (node, code, args) => binder.report(scope, node, code, args));
  }
  const outer = createOuterScope(),
    seen = new Map();
  for (const directive of [...(usings.global ?? []), ...usings.directives]) {
    // A global using directive of another file is bound here too; what is wrong with it is reported in that file.
    const origin = usings.globalUris?.get(directive) ?? scope.uri,
      isForeign = origin !== scope.uri,
      at = isForeign ? { uri: origin } : scope;
    const target = directive.namespaceOrType,
      alias = directive.alias?.name?.identifier?.valueText ?? null;
    if (!isForeign) for (const problem of checkUsingDirectiveSyntax(directive, !!host.allowUnsafe)) binder.report(at, problem.node, problem.code, []);
    if (alias) {
      if (bound.aliases.has(alias)) binder.report(at, directive.alias.name, DiagnosticId.CS1537, [alias]);
      else bound.aliases.set(alias, { syntax: directive, scope: isForeign ? foreignScope(outer, origin) : outer, target: undefined });
      continue;
    }
    // While an implicit using is bound the host records a namespace the registry lacks instead of giving up.
    host.bindingImplicitUsing = origin === implicitUsingsUri;
    const symbol = binder.bindNamespaceOrType(target, outer, { quietMissingNamespace: true });
    host.bindingImplicitUsing = false;
    if (!symbol || symbol.kind === SymbolKind.ErrorType) {
      reportMissingTarget(binder, at, target, symbol, origin === implicitUsingsUri);
      continue;
    }
    const key = (directive.staticKeyword ? 'static ' : '') + symbol.toDisplayString(),
      previous = seen.get(key);
    if (previous) {
      // Repeating a directive of the same file is CS0105; repeating a global using of another file is not reported.
      if (previous === 'own' && !isForeign) binder.report(scope, target, DiagnosticId.CS0105, [symbol.toDisplayString()]);
      if (!isForeign) seen.set(key, 'own');
      continue;
    }
    seen.set(key, isForeign ? 'foreign' : 'own');
    const isNamespace = symbol.kind === SymbolKind.Namespace;
    if (directive.staticKeyword) {
      if (isNamespace) binder.report(at, target, DiagnosticId.CS7007, [symbol.toDisplayString()]);
      else bound.staticTypes.push(symbol);
    } else if (isNamespace) {
      bound.namespaces.push(symbol);
      // A namespace that exists only as the parent of a modelled one (System.Linq of System.Linq.Expressions) has
      // types and extension methods the registry does not list: what it could supply is unknown, like an unmodelled using.
      const isImplicit = origin === implicitUsingsUri;
      if (!symbol.getTypeMembers().length && host.tolerateNamespace?.(textOf(target), { isImplicit })) host.unknownUsing?.();
    } else binder.report(at, target, DiagnosticId.CS0138, [symbol.toDisplayString()]);
  }
  return bound;
}

/** The scope a global alias of another file is bound in: the outer scope, reporting into that file. */
function foreignScope(outer, uri) {
  return Object.assign(Object.create(Object.getPrototypeOf(outer)), outer, { uri });
}

/** A directive whose target did not bind: silent for a BCL namespace or type outside the registry, an error otherwise. */
function reportMissingTarget(binder, scope, target, symbol, isImplicit = false) {
  const host = binder.host;
  if (symbol?.isFrameworkGap || host.tolerateNamespace?.(textOf(target), { isImplicit })) {
    host.unknownUsing?.();
    return;
  }
  if (symbol?.missing) binder.report(scope, symbol.missing.node, symbol.missing.code, symbol.missing.args);
}

/** The namespace or type an alias entry of `bindUsingDirectives` stands for; bound once, null while being bound. */
export function bindAliasTarget(binder, entry) {
  if (entry.target !== undefined) return entry.target;
  entry.target = null;
  const target = entry.syntax.namespaceOrType;
  entry.target = nameKinds.has(target.kind) ? binder.bindNamespaceOrType(target, entry.scope) : binder.bindType(target, entry.scope).type;
  const problem = checkAliasTargetType(entry.syntax, entry.target);
  if (problem) binder.report(entry.scope, problem.node, problem.code, []);
  return entry.target;
}

/** Binds every directive and alias target of a scope, so that their diagnostics do not depend on a later lookup. */
export function bindAllUsings(binder, scope) {
  const bound = binder.usingsOf(scope);
  if (!bound) return;
  for (const entry of bound.aliases.values()) bindAliasTarget(binder, entry);
}
