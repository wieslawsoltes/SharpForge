# Main f009 reconciliation checkpoint — 2026-10-04

The local reconciliation commit
`01745592db079b44f248ecc460ed09f0a01b9df5` and its public equivalent
`36a2af53287a563fd47d3a33b8e6e6382a726d35` have the identical tree
`da3add4a11cce5ed887d2a093eac4b48a4c26754`. Their first parents also have
identical trees. Both merge upstream main
`f009e2949f3311f0ca84a4a6bc694535140d130b`.

The [independent Git-object review](git-review.json) records the exact read-only
commands and results. The first-parent diff changes **264 paths total**.
The recorded automatic merge tree differs from the committed result only in
`packages/cil/src/index.js`; the other 263 changed paths retain the automatic
merge result. The [resolved index diff](resolved-index.diff) preserves A05's
`readSourceTypeIdentities` export and adds upstream's `MetadataGenerations` and
`metadataGenerationDiagnosticCatalog` exports. No runtime, bytecode, BCL,
`bench/`, A05 test or workflow path changed in this reconciliation.

The existing [export smoke log](a05-main-f009-cil-exports.log) records a successful
package-entrypoint import. Its [original journal](a05-main-f009-cil-exports-journal.json)
retains the exact command, the three resource limits (1/1/512), timestamps and
exit code zero. It checks that the two exported functions are functions and the
diagnostic catalog is truthy. This is a limited import smoke, with no test-suite
count or metadata behavior coverage.

The journal identifies the pre-merge parent and merged main revision, but does
not capture the executed HEAD/tree, working directory, tracked clean status,
Node version, `NODE_OPTIONS` or effective V8 heap limit. Root supplied the log
as verification of the resolved merge; the separate Git review establishes the
committed local/public tree equality. These are distinct provenance statements.

The [manifest](manifest.json) records SHA-256 and byte length for all six supplied
records and both review artifacts. Original logs, including the initially
conflicted merge output and empty merge-tree stderr, are preserved byte-for-byte.
Root reported eight whitespace notices in the entire merge diff from imported
upstream files; that original output was not among the supplied records and was
not reconstructed here. The manually resolved index independently passes
`git diff --check`. Upstream fixture whitespace is unchanged.

No new tests, builds, benchmarks, generators, browser or native execution ran
during this archival review, and no broad worktree merge was performed. Full
post-merge CI remained pending at this checkpoint. This archive does not update
project completion status or claim a full post-merge pass.
