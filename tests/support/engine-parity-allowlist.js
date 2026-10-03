/** Add only observed, reviewed differences after full-epic qualification.
 * Each entry requires fixture, owner, reason, tracking issue, and narrowly scoped
 * outputReplacements [{pattern, replacement}]. These never prevent execution.
 * Exception types, states and exit codes always remain strict comparisons.
 * Missing owners/reasons, unknown fixture IDs and stale entries fail the gate.
 */
export const engineParityAllowlist=Object.freeze([
  {
    fixture:'sample/gc',owner:'A05 runtime (@wieslawsoltes)',
    reason:'Observed at E04 commit 445a105: source and reloaded source report 216 bytes after collection, direct CIL 352 bytes. The emitted string-concatenation/boxing temporaries retain a different live heap; both report 136 before collection and one collection.',
    issue:'https://github.com/wieslawsoltes/SharpForge/issues/724',
    outputReplacements:[{pattern:/^After: (216|352) bytes$/gm,replacement:'After: <observed-engine-heap-bytes> bytes'}]
  },
  {
    fixture:'sample/particles',owner:'A05 runtime (@wieslawsoltes)',
    reason:'Observed at E04 commit 445a105: source and reloaded source report 1178 live bytes, direct CIL 1498. Compiler IR and emitted CIL use different temporary allocations for the same calculation; all tick values and surrounding output match.',
    issue:'https://github.com/wieslawsoltes/SharpForge/issues/724',
    outputReplacements:[{pattern:/^Managed memory: (1178|1498) bytes$/gm,replacement:'Managed memory: <observed-engine-heap-bytes> bytes'}]
  }
]);
