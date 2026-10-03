/**
 * The recursion budget shared by every recursive parser entry: statements, expressions, types, patterns, initializers,
 * type bodies and namespaces all call enter()/leave(), so no input can nest the JavaScript stack deeper than the budget.
 * When it is exhausted the parser reports SF1099 once - SharpForge's equivalent of Roslyn's CS8078, "an expression is too
 * long or complex to compile" - and abandons the rest of the input as skipped text: nothing is lost from the tree, and
 * no further recursion or lookahead runs over the remaining tokens. enter() is also where the parser polls its
 * cancellation token, once every 256 calls.
 */
export const nestingBudget = 200;
export const budgetMethods = {
  /** Takes one level of the budget. Returns false (after reporting and skipping the rest of the input) when none is left; leave() must still be called. */
  enter(message = 'Syntax nesting limit exceeded') {
    if (this.cancellation && (++this.ticks & 255) === 0) this.cancellation.throwIfCancellationRequested();
    if (++this.depth <= nestingBudget) return true;
    if (!this.budgetExhausted) {
      this.budgetExhausted = true;
      this.error(this.current, 'SF1099', message);
    }
    this.skipRest();
    return false;
  },
  leave() {
    this.depth--;
  }
};
