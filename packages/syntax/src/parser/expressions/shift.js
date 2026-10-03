/**
 * C# 11 unsigned right shift. The lexer produces single `>` tokens so that `List<List<int>>` closes two type argument
 * lists; the parser joins adjacent `>` tokens into `>>`, `>>>`, `>>=` and `>>>=` (see Parser.operatorAt), and the
 * precedence table gives `>>>` the precedence of the other shifts. This module records the feature the way Roslyn
 * reports it: over the whole shift expression or assignment, and over the operator token of a declaration.
 */
export const shiftMethods = {
  /** An expression `a >>> b` or `a >>>= b` whose tokens run from index `start` to the token before the cursor. */
  unsignedRightShiftExpression(start) {
    this.feature('UnsignedRightShift', this.tokens[start], this.tokens[this.i - 1]);
  },
  /** `operator >>>` in a declaration; the cursor is after the operator, which is made of the three `>` tokens before it. */
  unsignedRightShiftOperator() {
    this.feature('UnsignedRightShift', this.tokens[this.i - 3], this.tokens[this.i - 1]);
  }
};
