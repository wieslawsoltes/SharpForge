/**
 * Rules of `using unsafe` and of aliases of any type (SF-A02-T80; C# 12 "using alias to any type"):
 *
 *   CS9131  `using unsafe N;` - only a `using static` or an alias directive can be unsafe
 *   CS0227  `using unsafe X = int*;` without /unsafe (on the keyword)
 *   CS0214  a pointer type in the target of an alias that is not `unsafe`
 *   CS9130  `using X = ref int;`            CS9132  `using X = string?;` (a nullable reference type)
 *
 * The order `unsafe static` (CS9133) is a syntax error the parser reports.
 */
import { DiagnosticId } from '../diagnostics/codes.js';
import { findPointerSyntax, unsafeMarker } from './unsafe-declarations.js';

/**
 * The diagnostics the syntax of one using directive decides.
 * @param directive a UsingDirective node  @param {boolean} allowUnsafe whether the compilation has /unsafe
 * @returns {{node: object, code: string}[]}
 */
export function checkUsingDirectiveSyntax(directive, allowUnsafe) {
  const results = [],
    unsafeKeyword = directive.unsafeKeyword ?? null,
    target = directive.namespaceOrType;
  if (unsafeKeyword && !directive.alias && !directive.staticKeyword) results.push({ node: unsafeKeyword, code: DiagnosticId.CS9131 });
  else if (unsafeKeyword && !allowUnsafe) results.push({ node: unsafeKeyword, code: DiagnosticId.CS0227 });
  if (!directive.alias || !target) return results;
  if (target.kind === 'RefType') results.push({ node: target.refKeyword ?? target, code: DiagnosticId.CS9130 });
  const pointer = unsafeKeyword ? null : findPointerSyntax(target);
  if (pointer) results.push({ node: unsafeMarker(pointer), code: DiagnosticId.CS0214 });
  return results;
}

/** CS9132 for an alias whose target is written `T?` and bound to a reference type; null otherwise. */
export function checkAliasTargetType(directive, type) {
  const target = directive.namespaceOrType;
  if (target?.kind !== 'NullableType' || type?.isReferenceType !== true) return null;
  return { node: target.questionToken ?? target, code: DiagnosticId.CS9132 };
}
