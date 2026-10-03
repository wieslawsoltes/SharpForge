/**
 * Error codes SharpForge reports while parsing because they depend only on the syntax, although Roslyn reports them
 * while binding. They are absent from Roslyn's parse-only diagnostics, so a comparison with a Roslyn syntax tree
 * leaves them out:
 *   CS1004  duplicate modifier
 *   CS8115  a throw expression is not allowed in this context
 */
export const boundPhaseCodes = Object.freeze(new Set(['CS1004', 'CS8115']));
