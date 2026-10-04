/** Preserve the legacy syntax adapter's literal shape without folding imprecise tokens. */
export function profileLiteral(node) {
  // The profile AST stores oversized integer tokens as imprecise Numbers.
  // Existing profile diagnostics select the exact semantic binder; attempting
  // an Int64 fold here could throw before that binder runs.
  if (node.type === 'int' && !Number.isSafeInteger(node.value)) return null;
  return ['int', 'double', 'bool', 'string', 'null'].includes(node.type)
    ? {type: node.type, value: node.value} : null;
}
