/**
 * Ref safety: escape-scope analysis (SF-A02-T04.6, C# 11 rules; csharp-11.0/low-level-struct-improvements).
 *
 * Every expression has a *safe context* (how far its value may escape - only interesting for ref structs, which can
 * hold references) and, when it is a variable, a *ref safe context* (how far a reference to it may escape). Contexts
 * are ordered: CallingMethod (anywhere) < ReturnOnly (out of the method by return or ref/out parameter only) <
 * CurrentMethod < nested local scopes (larger numbers are narrower).
 *   CS8352  a value whose safe context is narrower than its destination allows
 *   CS8353  a stackalloc result escaping          CS8350 / CS8351  arguments or ref-conditional branches of mixed scopes
 *   CS8374 / CS9079  ref assignment to a wider ref      CS8166-CS8170, CS9075-CS9078  returning a reference too narrow
 * `scoped` narrows a parameter or local to the current method; `[UnscopedRef]` widens `this` of a struct, an `out`
 * parameter or a `ref` parameter to the next wider context.
 *
 * The contexts live in ./escape/contexts.js, the checks in ./escape/checks.js and the walk over a bound body in
 * ./escape/walker.js; `analyzeRefSafety` is what the semantic analysis calls for every method body.
 */
import { EscapeContexts, EscapeScope, localScope } from './escape/contexts.js';
import { EscapeChecks } from './escape/checks.js';
import { RefSafetyWalker } from './escape/walker.js';
import { InlineArrayEscape } from './escape/inline-arrays.js';

export { EscapeScope, localScope };

const withoutNode = problems => (problems.length ? { code: problems[0].code, args: problems[0].args } : null);

export class RefSafety extends InlineArrayEscape(EscapeChecks(EscapeContexts)) {
  /** `return value;` - the first problem as `{ code, args }`, or null. */
  checkReturn(value) {
    return withoutNode(this.valueEscapeProblems(value, EscapeScope.ReturnOnly));
  }
  /** `return ref e;` - the first problem as `{ code, args }`, or null. */
  checkRefReturn(expression) {
    return withoutNode(this.refEscapeProblems(expression, EscapeScope.ReturnOnly));
  }
}

/**
 * Ref safety problems of one bound body.
 * @param method the method symbol (null for top-level statements)
 * @param body its bound body (binder/body-binder.js)
 * @param {{ useUpdatedEscapeRules?: boolean }} [options]
 * @returns {{ node: object, code: string, args: any[] }[]}
 */
export function analyzeRefSafety(method, body, options = {}) {
  if (!body) return [];
  const create = (owner, locals) => new RefSafety({ ...options, method: owner, locals });
  return new RefSafetyWalker(create(method, new Map()), create).run(body);
}
