/**
 * Nullable syntax in expressions: the postfix `!` suppression operator. Conditional access (`?.`, `?[`) is parsed in
 * conditional-access.js, and the `T?` versus `c ? a : b` rule for types lives in types.js (mode 'afterIs').
 */
export const nullabilityMethods = {
  /** A postfix `!` suppresses nullable warnings; `!=` is already a single token, so any `!` after an operand qualifies. */
  isSuppression() {
    return true;
  }
};
