/** Add only observed, reviewed differences after full-epic qualification.
 * Each entry requires fixture, owner, reason, tracking issue, and narrowly scoped
 * outputReplacements [{pattern, replacement}]. These never prevent execution.
 * Exception types, states and exit codes always remain strict comparisons.
 * Missing owners/reasons, unknown fixture IDs and stale entries fail the gate.
 */
export const engineParityAllowlist=Object.freeze([]);
