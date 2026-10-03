/**
 * Rules particular to C# 2 anonymous methods (SF-A02-T51). Lambda binding (body/lambdas.js) does the common work:
 * target typing, parameter and return checks, capture. This module adds what `delegate { }` changes:
 *
 *   - Without a parameter list an anonymous method fits a delegate with any parameters, except out parameters,
 *     which it could not assign (CS1688).
 *   - With a parameter list the ref kinds must be the delegate's (CS1676 when the delegate's parameter is by
 *     reference, CS1677 when only the anonymous method's is).
 *   - Its conversion diagnostics point at the `delegate` keyword, and at a parameter's name.
 *   - A ref, out or in parameter of the enclosing method cannot be used inside it (CS1628; the rule is the same for
 *     lambdas and local functions).
 */
import { RefKind, SymbolKind } from '../symbols/types.js';

const refWords = { ref: RefKind.Ref, out: RefKind.Out, in: RefKind.In };
const byReference = kind => !!kind && kind !== RefKind.None;
/** The ref kind an anonymous function parameter declares in source. */
const declaredRefKind = parameter => {
  const word = (parameter.modifiers ?? []).map(token => token.text).find(text => Object.hasOwn(refWords, text));
  return word ? refWords[word] : RefKind.None;
};

/** What a diagnostic about an anonymous function as a whole points at: the `delegate` keyword, else the given node. */
export const anonymousFunctionAnchor = (syntax, fallback = null) => syntax.delegateKeyword ?? fallback;

/**
 * Signature errors of an anonymous method against the Invoke method of its target delegate.
 * @param syntax the AnonymousMethodExpression  @param {object[]|null} parameterSyntax its parameters, null without a list
 * @returns {null|{node: object, code: string, args: any[]}[]}
 */
export function anonymousMethodSignatureErrors(syntax, parameterSyntax, invoke) {
  if (syntax.kind !== 'AnonymousMethodExpression') return null;
  if (!parameterSyntax) {
    return invoke.parameters.some(parameter => parameter.refKind === RefKind.Out) ? [{ node: syntax.delegateKeyword, code: 'CS1688', args: [] }] : null;
  }
  if (parameterSyntax.length !== invoke.parameters.length) return null;
  for (let i = 0; i < parameterSyntax.length; i++) {
    const declared = declaredRefKind(parameterSyntax[i]),
      expected = invoke.parameters[i].refKind ?? RefKind.None;
    if (declared === expected || (!byReference(declared) && !byReference(expected))) continue;
    const node = parameterSyntax[i].identifier ?? parameterSyntax[i];
    return [byReference(expected) ? { node, code: 'CS1676', args: [i + 1, expected] } : { node, code: 'CS1677', args: [i + 1, declared] }];
  }
  return null;
}

/** Class mixin: uses of the enclosing method's by-reference parameters inside anonymous functions. */
export const AnonymousMethodBinding = Base =>
  class extends Base {
    /** True when `symbol` is a ref, out or in parameter of an enclosing function, not of the function being bound. */
    isOuterByRefParameter(symbol) {
      if (symbol.kind !== SymbolKind.Parameter || !byReference(symbol.refKind)) return false;
      return !this.scopes.some(scope => scope.get(symbol.name) === symbol);
    }
  };
