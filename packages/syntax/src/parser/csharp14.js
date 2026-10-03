/**
 * C# 14 forms that hook into older grammar: unbound generic types in `nameof` (`nameof(List<>)`) and modifiers on
 * the parameters of an implicitly typed lambda (`(ref x, out y) => ...`). Null-conditional assignment
 * (`a?.b = c`) is parsed with the conditional access itself (conditional-access.js). Each is recorded where Roslyn
 * reports it.
 */
const untypedFollowers = new Set([',', ')', '=']);
export const csharp14Methods = {
  /**
   * A generic name in an expression whose type arguments are omitted (`List<>`, `Dictionary<,>`), which is only
   * meaningful as an operand of `nameof`. `identifier` is its first token; the cursor is after the closing `>`.
   */
  unboundGenericName(identifier, open) {
    const first = this.kindAt(open + 1);
    if (first === '>' || first === ',') this.feature('UnboundGenericTypesInNameof', identifier, this.tokens[this.i - 1]);
  },
  /** In a lambda parameter list, `scoped x` is the modifier and an untyped parameter rather than a parameter of type scoped. */
  isSimpleLambdaScoped() {
    return this.atWord('scoped') && this.isId(this.peek()) && untypedFollowers.has(this.kindAt(this.i + 2));
  },
  /** An implicitly typed lambda parameter with modifiers, whose tokens start at index `from`. */
  simpleLambdaParameterModifiers(from) {
    this.feature('SimpleLambdaParameterModifiers', this.tokens[from], this.tokens[this.i - 1]);
  }
};
