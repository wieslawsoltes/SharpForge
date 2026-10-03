/**
 * Decides when `compile()` must ask the semantic analysis about using directives and namespace names (SF-A02-T24).
 *
 * The execution pipeline binds using directives leniently and never reports them. Running the semantic analysis for
 * every program would double the compile time, so this module makes the cheap decision: `suspiciousUsings` is
 * non-null when a directive does not bind to what its form requires, repeats another one, or declares an alias that
 * collides with a declaration. Only then is the analysis run, and `isUsingDiagnostic` / `isNamespaceDiagnostic` say
 * which of its diagnostics belong to using directives and namespace lookup.
 */
import {DiagnosticId} from '../diagnostics/codes.js';
import { SymbolKind } from '../symbols/types.js';
import { isBclNamespace } from '../symbols/bcl-namespaces.js';
import { collectUsingDirectives, resolveQualifiedName } from './usings.js';
import { checkGlobalUsingPlacement } from './global-usings.js';

/** Diagnostics of a using or extern alias directive itself. */
const directiveCodes = new Set([DiagnosticId.CS0246, DiagnosticId.CS0234, DiagnosticId.CS0138, DiagnosticId.CS7007, DiagnosticId.CS1537, DiagnosticId.CS0105, DiagnosticId.CS0430, DiagnosticId.CS1681, DiagnosticId.CS0426, DiagnosticId.CS8914, DiagnosticId.CS8915]);
/** Diagnostics that only namespace and alias lookup produce, wherever they are reported. */
const namespaceCodes = new Set([DiagnosticId.CS0234, DiagnosticId.CS0138, DiagnosticId.CS7007, DiagnosticId.CS1537, DiagnosticId.CS0576, DiagnosticId.CS0431, DiagnosticId.CS0432, DiagnosticId.CS0430]);
const plainName = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/**
 * What is wrong with one directive: null, 'directive' (it cannot be what its form says, or repeats another one) or
 * 'aliasConflict' (its alias has the name of a declaration, which is an error only where the name is used).
 */
function suspicion(directive, globalNamespace, seen, aliases, declared) {
  if (directive.kind === 'alias') {
    if (declared(directive.alias)) return 'aliasConflict';
    if (aliases.has(directive.alias)) return 'directive';
    aliases.add(directive.alias);
  } else {
    const key = directive.kind + ':' + directive.name;
    if (seen.has(key)) return 'directive';
    seen.add(key);
  }
  // Alias and static targets that are not dotted names (generic or predefined types) are left to the pipeline.
  if (!plainName.test(directive.name)) return null;
  const target = resolveQualifiedName(globalNamespace, directive.name).symbol;
  if (!target) return isBclNamespace(directive.name) ? null : 'directive';
  const isNamespace = target.kind === SymbolKind.Namespace,
    wrongKind = directive.kind === 'namespace' ? !isNamespace : directive.kind === 'static' && isNamespace;
  return wrongKind ? 'directive' : null;
}

/**
 * @param compilation the Compilation (its `inputFiles`, `semantic.globalNamespace` and declared `types`)
 * @returns {null|'directives'|'names'} null for ordinary programs; 'directives' when binding the using directives
 *   is enough to diagnose them; 'names' when the program's names must be bound too (an alias conflict, extern aliases)
 */
export function suspiciousUsings(compilation) {
  const globalNamespace = compilation.semantic.globalNamespace;
  let names = null;
  const declared = name => {
    names ??= new Set(compilation.types.flatMap(type => [type.node?.name, (type.node?.namespace ?? '').split('.')[0]]).filter(Boolean));
    return names.has(name);
  };
  let result = null;
  // Global aliases share one declaration space across files.
  const globalAliases = new Set();
  for (const file of compilation.inputFiles) {
    if (file.syntax?.externs?.length) return 'names';
    if (checkGlobalUsingPlacement(file).length) result = 'directives';
    const scopes = new Map();
    for (const directive of collectUsingDirectives(file)) {
      if (directive.isGlobal && directive.kind === 'alias') {
        if (globalAliases.has(directive.alias)) result = 'directives';
        globalAliases.add(directive.alias);
      }
      let scope = scopes.get(directive.namespace);
      if (!scope) scopes.set(directive.namespace, (scope = { seen: new Set(), aliases: new Set() }));
      const found = suspicion(directive, globalNamespace, scope.seen, scope.aliases, declared);
      if (found === 'aliasConflict') return 'names';
      if (found) result = 'directives';
    }
  }
  return result;
}

/** The spans of every using and extern alias directive of the parsed files, per document uri. */
function directiveSpans(files) {
  const spans = new Map();
  const visit = (container, list) => {
    for (const directive of [...(container.externs ?? []), ...(container.usings ?? [])]) list.push(directive.span);
    for (const member of container.members ?? []) {
      if (member.kind === 'NamespaceDeclaration' || member.kind === 'FileScopedNamespaceDeclaration') visit(member, list);
    }
  };
  for (const file of files) {
    if (!file.syntax) continue;
    const list = [];
    visit(file.syntax, list);
    spans.set(file.source.uri, list);
  }
  return spans;
}

/**
 * Classifies the diagnostics of the semantic analysis.
 * @returns {{isUsingDiagnostic(d):boolean, isNamespaceDiagnostic(d):boolean}} `isUsingDiagnostic`: reported inside a
 *   using or extern alias directive; `isNamespaceDiagnostic`: that, or a code only namespace and alias lookup produce
 */
export function usingDiagnosticClassifier(files) {
  let spans = null;
  const isUsingDiagnostic = d => {
    if (!directiveCodes.has(d.code)) return false;
    spans ??= directiveSpans(files);
    return (spans.get(d.uri) ?? []).some(span => span.start <= d.start && d.start < span.end);
  };
  return { isUsingDiagnostic, isNamespaceDiagnostic: d => namespaceCodes.has(d.code) || isUsingDiagnostic(d) };
}
