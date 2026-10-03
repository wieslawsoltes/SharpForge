/**
 * Error codes SharpForge reports while parsing because they depend only on the syntax, although Roslyn reports them
 * while binding. They are absent from Roslyn's parse-only diagnostics, so a comparison with a Roslyn syntax tree
 * leaves them out:
 *   CS1004  duplicate modifier
 *   CS1107  duplicate parameter modifier
 *   CS8115  a throw expression is not allowed in this context
 *   CS8954, CS8955, CS8956  the placement rules of file-scoped namespaces
 *   CS9273  a local or parameter named `field` declared inside a property accessor
 * The warning CS9258 (the `field` keyword hides a member named field) is reported the same way.
 */
export const boundPhaseCodes = Object.freeze(new Set(['CS1004', 'CS1107', 'CS8115', 'CS8954', 'CS8955', 'CS8956', 'CS9273']));
