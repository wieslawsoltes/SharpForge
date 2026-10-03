/**
 * C# 14 operator declarations: user-defined compound assignment (`public void operator +=(int x)`, also `checked`) and
 * instance increment and decrement (`public void operator ++()`). Operators declared inside extension blocks use the
 * ordinary operator syntax and need no parser support beyond the block itself.
 */
const compoundAssignment = /^(?:[-+*\/%&|^]|<<|>>>?)=$/;
export const modernOperatorMethods = {
  /** Records the features an operator declaration with operator token text `text` needs; `start` anchors the diagnostic. */
  operatorFeatures(text, modifiers, start, end = start) {
    if (text === '>>>') this.unsignedRightShiftOperator();
    else if (compoundAssignment.test(text) || ((text === '++' || text === '--') && !modifiers.some(modifier => modifier.kind === 'StaticKeyword')))
      this.feature('UserDefinedCompoundAssignmentOperators', start, end);
  }
};
