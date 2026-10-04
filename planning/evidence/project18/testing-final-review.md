# Project18 final source and publication handoff

The frozen source is `0bb2ed360a13f3cda3d990bd3f2ff4cebb8dd760`
with tree `7399d972ea939b8a5f05f894bc793f9b713cfd49`.
The actual Release13 browser run passed all 16 checks with no page errors.
Its product and build bytes are the previously qualified `7d4c97d2` source;
the only descendant change is the Python worker-ownership assertion in the
browser fixture. The final combined timer and worker scope passed 34/34,
and check, build and clean-checkout gates passed. The earlier complete Node 22
scope passed 1,877/1,877 with no skipped tests. These overlapping scopes are
recorded separately in the [integration evidence](integration.json).

This document is a small source-bound handoff. The complete machine-readable
claims, original source identities, ordered publication parents and remaining
gates are in [testing-final-handoff.json](testing-final-handoff.json).
It adds no product changes and does not claim that the protected entry patches
have been applied or executed.

## Coverage and review structure

The final census records 159 distinct feature pull requests covering all 157
leaf identities through 166 implementation records. Nine leaves have records
from more than one contributor. The project contains eight epics and 24 parent
tasks. Record presence establishes traceability; it does not establish that
every acceptance condition, platform cell or review gate has passed.

Implementation used isolated worktrees and complete feature batches. Drafts
are stacked on actual prerequisites. Where integration required a change below
a stack, forward merges retained the old published heads and both sides of
the change. No force push, rebase, squash or main merge is part of this handoff.
Required ordinary core checks and the deliberately scheduled larger scopes
remain separate in the publication receipts.

The final parent audit resolves all 159 actual published heads into 34 maximal
actual parents. There are no unresolved ancestry nodes and no claimed-tree or
immediate-parent mismatches. Pinned main `1db2e1d5` is already reachable from
that parent set. Local projection commits are identified separately from the
actual published commits. The final census is sealed at the content SHA-256
recorded in the JSON handoff. Its row identities match the completed
actual-parent audit.

The proposed aggregate branch will contain the final canonical tree and those
actual ordered parents. It is a branch for retrieving the reviewed composition,
with the individual feature drafts retained as the review units. Its commit
identity will differ from the original local integration identity because its
parents are the actual published feature history. The source bundle preserves
the original identities independently.

## Qualification and remaining limits

Initial failures remain part of the evidence. The first complete Node 26 run
had 1,875 tests, 1,809 passes and 66 failures. The subsequent affected scope had
259/260 passes; the remaining resource correction passed 52/52. Later complete
and focused scopes preserved every original assertion or explicitly replaced
an assertion that represented obsolete behavior. The final worker fixture
checks exact designer no-churn, current ownership and live-worker bounds,
rather than the historical count of all workers ever created.

The omission audit found no missing product implementation among the 151
published-only paths it reviewed. Eighteen unique qualification cases from
eight files were retained and passed within the final status-and-retained
43-test scope. Intentionally replaced facades, duplicate extracted cases and
upstream-removed syntax fixtures remain classified in
[the retained contribution record](retained-qualification-contributions.json).

The final legacy-file cleanup did not relax the structure baseline. Pinned
main has 268 strict findings and the final source has 265; there are no new or
worsened over-budget dimensions and no actual growth in the frozen files.
All 159 baseline entries remain unchanged. The strict gate is still nonzero
and must not be described as passing.

The matched Release14 measurement uses three alternating baseline/final pairs
and 12 warm samples per workload and tree. All eight outputs are correct and
managed allocation counts are unchanged. Queue/source median time increased
by 11.53 percent, while its p95 decreased by 8.94 percent. The other recorded
p95 increases also remain review items. The benchmark inputs and all 16 package
dependency trees are identical between the measured source and the final
product source. This is an input-equivalence proof, not a new measurement or
an application/editor performance claim. Performance justification and
sign-off remain outstanding; shared-machine uncertainty does not explain
away the measured regression.

The successful Release13 replay does not resolve the independent storage
qualification failure. The real Chromium storage probe completed OPFS,
plain IndexedDB and directory-handle PUT operations, then reproduced a
SIGTRAP during persisted-handle GET. Later identity and Web Lock checks were
not reached. The exact failed traces remain in the raw archive.

Native Linux SDK and separate-assembly oracle results are recorded by exact
toolchain and source. The bounded external framework restore timed out before
packages were available. Native xUnit/NUnit/MSTest framework qualification,
Windows/macOS and other unavailable engine/browser cells remain explicit
limits. Protocol mocks and portable tests are not substitutes for those cells.

## Protected review and durable artifacts

The [protected integration review](integration/README.md) contains the current
Studio and lockfile patches, metadata, transformations, historical patch
versions and fresh lease observation. The authoritative copy receipt selects
13 files. Both patches pass text-only applicability checks. The proposed entry
was not applied or executed, and the actual Studio entry and root manifests
still equal pinned main. Applying them remains subject to the existing
owner/lease coordination.

Raw qualification is sealed separately at
`cba546ab959247462ce319f89683c06b7861c4ff`. Its subtree contains 319 payloads,
64,887,154 payload bytes, ten bounded checksum shards and 330 total files.
All failed and successful history, runner versions, scopes and source records
remain included. The bulky raw branch is not merged into canonical product
history. It will be preserved in `qualification-raw.tar.gz`.

The prepared driver freezes explicit safe input paths and hashes, then creates
the incremental `integration.bundle` and deterministic raw archive under the
ordinary resource limiter. Bundle verification checks every required object
outside pinned ancestry and verifies that the original canonical commit
resolves to the frozen tree without alternate object lookup. Archive verification
checks every decompressed member. No candidate executable, credential, cache,
unrelated worktree or untracked build output is selected.

At this handoff the source and publication plans are prepared. The aggregate
branch, source bundle, raw archive and evidence draft have not yet been created.
Root must first freeze the final canonical metadata and release the verified file selection. Binary upload receipts will
record content-address verification and, after the evidence branch exists,
an exact-ref Git fetch will independently verify the actual binary bytes.
