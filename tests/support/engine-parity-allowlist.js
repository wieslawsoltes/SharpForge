/** Add only observed, reviewed differences after full-epic qualification.
 * Each entry requires fixture, owner, reason, tracking issue, and narrowly scoped
 * outputReplacements [{pattern, replacement}]. These never prevent execution.
 * Exception types, states and exit codes always remain strict comparisons.
 * Missing owners/reasons, unknown fixture IDs and stale entries fail the gate.
 */
export const engineParityAllowlist=Object.freeze([
  {
    fixture:'sample/gc',owner:'A05 runtime (@wieslawsoltes)',
    reason:'Observed at E01 commit c1cae61d: source and reloaded source retain 242 bytes after collection, direct CIL retains 338 bytes. String formatting and emitted boxing use different live temporaries; both report 136 before collection and one collection.',
    issue:'https://github.com/wieslawsoltes/SharpForge/issues/724',
    outputReplacements:[{pattern:/^After: (242|338) bytes$/gm,replacement:'After: <observed-engine-heap-bytes> bytes'}]
  }
]);
