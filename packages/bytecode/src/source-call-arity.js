/** Vararg definitions expose only fixed parameters; optional slots belong to each call site. */
export function sourceCallArity(method, count) {
  const fixed = method.parameters.length + (method.isStatic ? 0 : 1);
  return Number.isInteger(count) && (method.callingConvention === 5 ? count >= fixed : count === fixed);
}
